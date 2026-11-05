import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { ToastProvider } from '@/components/ui/Toast';
import { toAppError } from '@/lib/supabase/errors';
import { AuthProvider } from './providers/AuthProvider';
import { router } from './router/routes';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Do not retry authorization or validation failures.
      retry: (count, error) => {
        const code = toAppError(error).code;
        return count < 2 && (code === 'NETWORK_ERROR' || code === 'UNKNOWN_ERROR');
      },
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
