package expo.modules.proxybeacon

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Bare-bones BLE for ProxyProof: the organiser's phone advertises a small
 * manufacturer-data packet, students' phones scan for it. No pairing, no GATT.
 */
@SuppressLint("MissingPermission") // runtime permissions are requested from JS before any call
class ProxyBeaconModule : Module() {
  private var advertiseCallback: AdvertiseCallback? = null
  private var scanCallback: ScanCallback? = null
  private var scanManufacturerId = 0

  private val adapter: BluetoothAdapter?
    get() {
      val context = appContext.reactContext ?: return null
      val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager?
      return manager?.adapter
    }

  override fun definition() = ModuleDefinition {
    Name("ProxyBeacon")

    Events("onBeacon", "onScanError")

    Function("getState") {
      val a = adapter
      when {
        a == null -> "unsupported"
        !a.isEnabled -> "off"
        else -> "on"
      }
    }

    Function("canAdvertise") {
      val a = adapter
      a != null && a.isEnabled && a.isMultipleAdvertisementSupported && a.bluetoothLeAdvertiser != null
    }

    AsyncFunction("startAdvertising") { manufacturerId: Int, payloadHex: String, promise: Promise ->
      val a = adapter
      if (a == null || !a.isEnabled) {
        promise.reject(CodedException("BLUETOOTH_OFF", "Bluetooth is off", null))
        return@AsyncFunction
      }
      val advertiser = a.bluetoothLeAdvertiser
      if (advertiser == null) {
        promise.reject(CodedException("ADVERTISE_UNSUPPORTED", "This phone can't broadcast BLE", null))
        return@AsyncFunction
      }

      // Swap the packet: stop the old advert, start one with the new token.
      stopAdvertisingInternal()

      val settings = AdvertiseSettings.Builder()
        .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
        .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
        .setConnectable(false)
        .setTimeout(0)
        .build()
      val data = AdvertiseData.Builder()
        .setIncludeDeviceName(false)
        .setIncludeTxPowerLevel(false)
        .addManufacturerData(manufacturerId, hexToBytes(payloadHex))
        .build()

      var settled = false
      val callback = object : AdvertiseCallback() {
        override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
          if (!settled) { settled = true; promise.resolve(null) }
        }

        override fun onStartFailure(errorCode: Int) {
          if (settled) return
          settled = true
          if (errorCode == ADVERTISE_FAILED_ALREADY_STARTED) promise.resolve(null)
          else promise.reject(CodedException("ADVERTISE_FAILED", "Advertising failed (code $errorCode)", null))
        }
      }
      advertiseCallback = callback
      try {
        advertiser.startAdvertising(settings, data, callback)
      } catch (e: SecurityException) {
        advertiseCallback = null
        if (!settled) { settled = true; promise.reject(CodedException("NO_PERMISSION", "Bluetooth permission missing", e)) }
      }
    }

    AsyncFunction("stopAdvertising") {
      stopAdvertisingInternal()
    }

    AsyncFunction("startScanning") { manufacturerId: Int, prefixHex: String, promise: Promise ->
      val a = adapter
      if (a == null || !a.isEnabled) {
        promise.reject(CodedException("BLUETOOTH_OFF", "Bluetooth is off", null))
        return@AsyncFunction
      }
      val scanner = a.bluetoothLeScanner
      if (scanner == null) {
        promise.reject(CodedException("SCAN_UNSUPPORTED", "This phone can't scan BLE", null))
        return@AsyncFunction
      }
      // Android throttles apps that restart scans too often, so keep one running.
      if (scanCallback != null && scanManufacturerId == manufacturerId) {
        promise.resolve(null)
        return@AsyncFunction
      }
      stopScanningInternal()

      val prefix = hexToBytes(prefixHex)
      val filter = ScanFilter.Builder()
        .setManufacturerData(manufacturerId, prefix, ByteArray(prefix.size) { 0xFF.toByte() })
        .build()
      val settings = ScanSettings.Builder()
        .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
        .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
        .setReportDelay(0)
        .build()

      val callback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
          val bytes = result.scanRecord?.getManufacturerSpecificData(manufacturerId) ?: return
          sendEvent("onBeacon", mapOf("payload" to bytesToHex(bytes), "rssi" to result.rssi, "at" to System.currentTimeMillis().toDouble()))
        }

        override fun onBatchScanResults(results: MutableList<ScanResult>) {
          results.forEach { onScanResult(ScanSettings.CALLBACK_TYPE_ALL_MATCHES, it) }
        }

        override fun onScanFailed(errorCode: Int) {
          scanCallback = null
          sendEvent("onScanError", mapOf("code" to errorCode))
        }
      }
      try {
        scanner.startScan(listOf(filter), settings, callback)
        scanCallback = callback
        scanManufacturerId = manufacturerId
        promise.resolve(null)
      } catch (e: SecurityException) {
        promise.reject(CodedException("NO_PERMISSION", "Bluetooth permission missing", e))
      }
    }

    AsyncFunction("stopScanning") {
      stopScanningInternal()
    }

    OnDestroy {
      stopAdvertisingInternal()
      stopScanningInternal()
    }
  }

  private fun stopAdvertisingInternal() {
    val cb = advertiseCallback ?: return
    advertiseCallback = null
    try {
      adapter?.bluetoothLeAdvertiser?.stopAdvertising(cb)
    } catch (_: Exception) {
    }
  }

  private fun stopScanningInternal() {
    val cb = scanCallback ?: return
    scanCallback = null
    try {
      adapter?.bluetoothLeScanner?.stopScan(cb)
    } catch (_: Exception) {
    }
  }

  private fun hexToBytes(hex: String): ByteArray {
    val clean = hex.trim()
    return ByteArray(clean.length / 2) { i -> clean.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
  }

  private fun bytesToHex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }
}
