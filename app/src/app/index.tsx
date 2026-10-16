import { Redirect } from 'expo-router';
import { useAuth } from '@/lib/auth';

export default function Index() {
  const { user } = useAuth();
  if (!user) return <Redirect href="/welcome" />;
  if (user.role === 'organiser') return <Redirect href="/organiser" />;
  if (user.role === 'admin') return <Redirect href="/admin" />;
  return <Redirect href="/student" />;
}
