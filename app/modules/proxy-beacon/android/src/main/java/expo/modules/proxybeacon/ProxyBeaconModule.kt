package expo.modules.proxybeacon

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.AdvertisingSet
import android.bluetooth.le.AdvertisingSetCallback
import android.bluetooth.le.AdvertisingSetParameters
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Bare-bones BLE for ProxyProof: the organiser's phone advertises a small
 * manufacturer-data packet, students' phones scan for it (and advertise a short
 * echo back). No pairing, no GATT.
 */
@SuppressLint("MissingPermission") // runtime permissions are requested from JS before any call
class ProxyBeaconModule : Module() {
  private val main = Handler(Looper.getMainLooper())

  // Advertising: an AdvertisingSet on Android 8+ (payload swaps without a gap),
  // the classic advertiser on Android 7.
  private var advertisingSet: AdvertisingSet? = null
  private var setCallback: AdvertisingSetCallback? = null
  private var legacyCallback: AdvertiseCallback? = null
  private var pendingAdvertise: Promise? = null
  /** Newest payload asked for while a set was still starting; applied once it starts. */
  private var queuedData: AdvertiseData? = null

  // Scanning
  private var scanCallback: ScanCallback? = null
  private var scanKey = ""
  private var scanManufacturerId = 0
  private var scanPrefix = ByteArray(0)
  private var retriedScan = false
  private val restartScan = Runnable { restartScanning() }
  private var retryErrorCode = 0
  private val retryScan = Runnable {
    if (scanKey.isNotEmpty() && scanCallback == null) {
      runCatching { beginScan() }.onFailure { sendEvent("onScanError", mapOf("code" to retryErrorCode)) }
    }
  }

  private val context: Context? get() = appContext.reactContext

  private val adapter: BluetoothAdapter?
    get() = (context?.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager?)?.adapter

  override fun definition() = ModuleDefinition {
    Name("ProxyBeacon")

    Events("onBeacon", "onScanError")

    Function("getState") {
      val a = adapter
      when {
        a == null -> "unsupported"
        !a.isEnabled -> "off"
        // Before Android 12, BLE scans return nothing while Location is switched off.
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S && !locationEnabled() -> "location_off"
        else -> "on"
      }
    }

    Function("canAdvertise") {
      val a = adapter
      a != null && a.isEnabled && a.isMultipleAdvertisementSupported && a.bluetoothLeAdvertiser != null
    }

    // Everything below runs on the main thread, the same one the Bluetooth callbacks use,
    // so the fields above are never touched from two threads at once.
    AsyncFunction("startAdvertising") { manufacturerId: Int, payloadHex: String, promise: Promise ->
      main.post { startAdvertisingOnMain(manufacturerId, payloadHex, promise) }
    }

    AsyncFunction("stopAdvertising") {
      main.post { stopAdvertisingInternal() }
    }

    AsyncFunction("startScanning") { manufacturerId: Int, prefixHex: String, promise: Promise ->
      main.post { startScanningOnMain(manufacturerId, prefixHex, promise) }
    }

    AsyncFunction("stopScanning") {
      main.post { stopScanningInternal() }
    }

    OnDestroy {
      main.post {
        stopAdvertisingInternal()
        stopScanningInternal()
      }
    }
  }

  // ---- advertising ----------------------------------------------------------

  private fun startAdvertisingOnMain(manufacturerId: Int, payloadHex: String, promise: Promise) {
      val a = adapter
      if (a == null || !a.isEnabled) {
        promise.reject(CodedException("BLUETOOTH_OFF", "Bluetooth is off", null))
        return
      }
      val advertiser = a.bluetoothLeAdvertiser
      if (advertiser == null) {
        promise.reject(CodedException("ADVERTISE_UNSUPPORTED", "This phone can't broadcast BLE", null))
        return
      }
      val data = AdvertiseData.Builder()
        .setIncludeDeviceName(false)
        .setIncludeTxPowerLevel(false)
        .addManufacturerData(manufacturerId, hexToBytes(payloadHex))
        .build()

      // A previous call that never got its callback shouldn't hang JS forever.
      pendingAdvertise?.resolve(null)
      pendingAdvertise = promise

      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          val current = advertisingSet
          if (current != null) {
            current.setAdvertisingData(data) // result arrives in onAdvertisingDataSet
          } else if (setCallback != null) {
            // Still starting: don't start a second set, just send this payload once it's up.
            queuedData = data
            settleAdvertise(null)
          } else {
            startSet(advertiser, data)
          }
        } else {
          startLegacy(advertiser, data)
        }
      } catch (e: SecurityException) {
        settleAdvertise(CodedException("NO_PERMISSION", "Bluetooth permission missing", e))
      }
  }

  private fun startScanningOnMain(manufacturerId: Int, prefixHex: String, promise: Promise) {
      val a = adapter
      if (a == null || !a.isEnabled) {
        promise.reject(CodedException("BLUETOOTH_OFF", "Bluetooth is off", null))
        return
      }
      // Android throttles apps that start scans more than 5 times in 30s, so if
      // we're already scanning for the same thing, leave it running.
      val key = "$manufacturerId:$prefixHex"
      if (scanCallback != null && scanKey == key) {
        promise.resolve(null)
        return
      }
      stopScanningInternal()
      scanKey = key
      scanManufacturerId = manufacturerId
      scanPrefix = hexToBytes(prefixHex)
      retriedScan = false
      try {
        beginScan()
        promise.resolve(null)
      } catch (e: SecurityException) {
        promise.reject(CodedException("NO_PERMISSION", "Bluetooth permission missing", e))
      } catch (e: IllegalStateException) {
        promise.reject(CodedException("SCAN_FAILED", e.message ?: "Scan failed", e))
      }
  }

  private fun startSet(advertiser: android.bluetooth.le.BluetoothLeAdvertiser, data: AdvertiseData) {
    val params = AdvertisingSetParameters.Builder()
      .setLegacyMode(true)
      .setConnectable(false)
      .setScannable(false)
      .setInterval(AdvertisingSetParameters.INTERVAL_LOW)
      .setTxPowerLevel(AdvertisingSetParameters.TX_POWER_HIGH)
      .build()
    val cb = object : AdvertisingSetCallback() {
      override fun onAdvertisingSetStarted(set: AdvertisingSet?, txPower: Int, status: Int) {
        if (setCallback !== this) {
          // Stopped (or replaced) before it finished starting: don't leave it on air.
          runCatching { advertiser.stopAdvertisingSet(this) }
          return
        }
        if (status == ADVERTISE_SUCCESS && set != null) {
          advertisingSet = set
          queuedData?.let { runCatching { set.setAdvertisingData(it) } }
          queuedData = null
          settleAdvertise(null)
        } else {
          setCallback = null
          settleAdvertise(CodedException("ADVERTISE_FAILED", "Advertising failed (code $status)", null))
        }
      }

      override fun onAdvertisingDataSet(set: AdvertisingSet?, status: Int) {
        if (setCallback !== this) return
        if (status != ADVERTISE_SUCCESS) {
          // Drop the broken set so the next call starts a fresh one.
          runCatching { advertiser.stopAdvertisingSet(this) }
          setCallback = null
          advertisingSet = null
        }
        settleAdvertise(if (status == ADVERTISE_SUCCESS) null else CodedException("ADVERTISE_FAILED", "Couldn't update advert (code $status)", null))
      }

      override fun onAdvertisingSetStopped(set: AdvertisingSet?) {
        if (set == advertisingSet) advertisingSet = null
      }
    }
    setCallback = cb
    advertiser.startAdvertisingSet(params, data, null, null, null, cb)
  }

  private fun startLegacy(advertiser: android.bluetooth.le.BluetoothLeAdvertiser, data: AdvertiseData) {
    legacyCallback?.let { runCatching { advertiser.stopAdvertising(it) } }
    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
      .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
      .setConnectable(false)
      .setTimeout(0)
      .build()
    val cb = object : AdvertiseCallback() {
      override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) = settleAdvertise(null)
      override fun onStartFailure(errorCode: Int) = settleAdvertise(
        if (errorCode == ADVERTISE_FAILED_ALREADY_STARTED) null
        else CodedException("ADVERTISE_FAILED", "Advertising failed (code $errorCode)", null),
      )
    }
    legacyCallback = cb
    advertiser.startAdvertising(settings, data, cb)
  }

  private fun settleAdvertise(error: CodedException?) {
    val p = pendingAdvertise ?: return
    pendingAdvertise = null
    if (error == null) p.resolve(null) else p.reject(error)
  }

  private fun stopAdvertisingInternal() {
    val advertiser = adapter?.bluetoothLeAdvertiser
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) setCallback?.let { advertiser?.stopAdvertisingSet(it) }
      legacyCallback?.let { advertiser?.stopAdvertising(it) }
    } catch (_: Exception) {
    }
    setCallback = null
    legacyCallback = null
    advertisingSet = null
    queuedData = null
    settleAdvertise(null)
  }

  // ---- scanning -------------------------------------------------------------

  private fun beginScan() {
    val scanner = adapter?.bluetoothLeScanner ?: throw IllegalStateException("This phone can't scan BLE")
    val filter = ScanFilter.Builder()
      .setManufacturerData(scanManufacturerId, scanPrefix, ByteArray(scanPrefix.size) { 0xFF.toByte() })
      .build()
    val settings = ScanSettings.Builder()
      .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
      .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
      .setReportDelay(0)
      .build()
    val id = scanManufacturerId
    val cb = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: ScanResult) {
        val bytes = result.scanRecord?.getManufacturerSpecificData(id) ?: return
        sendEvent("onBeacon", mapOf("payload" to bytesToHex(bytes), "rssi" to result.rssi, "at" to System.currentTimeMillis().toDouble()))
      }

      override fun onBatchScanResults(results: MutableList<ScanResult>) {
        results.forEach { onScanResult(ScanSettings.CALLBACK_TYPE_ALL_MATCHES, it) }
      }

      override fun onScanFailed(errorCode: Int) {
        if (scanCallback !== this) return
        scanCallback = null
        main.removeCallbacks(restartScan)
        // One quiet retry before bothering the user.
        if (!retriedScan) {
          retriedScan = true
          retryErrorCode = errorCode
          main.removeCallbacks(retryScan)
          main.postDelayed(retryScan, 2000)
        } else {
          sendEvent("onScanError", mapOf("code" to errorCode))
        }
      }
    }
    scanner.startScan(listOf(filter), settings, cb)
    scanCallback = cb
    // Android quietly downgrades scans older than 30 minutes, so refresh at 25.
    main.removeCallbacks(restartScan)
    main.postDelayed(restartScan, 25 * 60 * 1000L)
  }

  private fun restartScanning() {
    val cb = scanCallback ?: return
    runCatching { adapter?.bluetoothLeScanner?.stopScan(cb) }
    scanCallback = null
    retriedScan = false
    runCatching { beginScan() }.onFailure { sendEvent("onScanError", mapOf("code" to -1)) }
  }

  private fun stopScanningInternal() {
    main.removeCallbacks(restartScan)
    main.removeCallbacks(retryScan)
    scanKey = ""
    val cb = scanCallback ?: return
    scanCallback = null
    try {
      adapter?.bluetoothLeScanner?.stopScan(cb)
    } catch (_: Exception) {
    }
  }

  // ---- helpers --------------------------------------------------------------

  private fun locationEnabled(): Boolean {
    val lm = context?.getSystemService(Context.LOCATION_SERVICE) as LocationManager? ?: return true
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      lm.isLocationEnabled
    } else {
      lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
    }
  }

  private fun hexToBytes(hex: String): ByteArray {
    val clean = hex.trim()
    return ByteArray(clean.length / 2) { i -> clean.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
  }

  private fun bytesToHex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }
}
