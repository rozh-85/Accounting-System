import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate } from 'react-router';
import { z } from 'zod';
import { useAuth } from '@/app/providers/AuthProvider';
import { AuthLayout } from '@/app/layouts/AuthLayout';
import { Button } from '@/components/ui/Button';
import { Alert } from '@/components/ui/Card';
import { Field, Input } from '@/components/ui/Field';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { errorMessage } from '@/lib/supabase/errors';

const loginSchema = z.object({
  email: z.string().trim().min(1, 'validation.required').email('validation.email'),
  password: z.string().min(1, 'validation.required'),
});

function ConfigurationWarning() {
  const { t } = useTranslation();
  if (isSupabaseConfigured) return null;
  return (
    <Alert tone="warning" title={t('auth.notConfiguredTitle')} className="mb-5">
      {t('auth.notConfiguredBody')}
    </Alert>
  );
}

export function LoginPage() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  if (session) return <Navigate to="/" replace />;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const { error: authError } = await supabase.auth.signInWithPassword(values);
    if (authError) return setError(errorMessage(authError, t));
    navigate('/', { replace: true });
  });

  const fieldError = (name: keyof z.infer<typeof loginSchema>) => {
    const message = form.formState.errors[name]?.message;
    return message ? t(message) : null;
  };

  return (
    <AuthLayout
      title={t('auth.signInTitle')}
      subtitle={t('auth.signInSubtitle')}
      footer={
        <>
          {t('auth.noAccount')}{' '}
          <Link to="/signup" className="font-medium text-accent hover:underline">
            {t('auth.createAccount')}
          </Link>
        </>
      }
    >
      <ConfigurationWarning />
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label={t('auth.email')} error={fieldError('email')} required>
          {(p) => <Input {...p} type="email" autoComplete="email" dir="ltr" {...form.register('email')} />}
        </Field>
        <Field label={t('auth.password')} error={fieldError('password')} required>
          {(p) => <Input {...p} type="password" autoComplete="current-password" dir="ltr" {...form.register('password')} />}
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-[12.5px] text-accent hover:underline">
            {t('auth.forgotPassword')}
          </Link>
        </div>
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting} className="w-full">
          {t('auth.signIn')}
        </Button>
      </form>
    </AuthLayout>
  );
}

const signUpSchema = z
  .object({
    fullName: z.string().trim().min(2, 'validation.required'),
    email: z.string().trim().min(1, 'validation.required').email('validation.email'),
    password: z.string().min(8, 'validation.passwordLength'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'validation.passwordMatch' });

export function SignUpPage() {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const form = useForm<z.infer<typeof signUpSchema>>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { fullName: '', email: '', password: '', confirm: '' },
  });

  if (session) return <Navigate to="/" replace />;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const { data, error: authError } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        data: { full_name: values.fullName, preferred_language: i18n.language },
        emailRedirectTo: `${window.location.origin}/`,
      },
    });
    if (authError) return setError(errorMessage(authError, t));
    if (data.session) navigate('/onboarding', { replace: true });
    else setConfirmationSent(true);
  });

  const fieldError = (name: keyof z.infer<typeof signUpSchema>) => {
    const message = form.formState.errors[name]?.message;
    return message ? t(message) : null;
  };

  return (
    <AuthLayout
      title={t('auth.signUpTitle')}
      subtitle={t('auth.signUpSubtitle')}
      footer={
        <>
          {t('auth.haveAccount')}{' '}
          <Link to="/login" className="font-medium text-accent hover:underline">
            {t('auth.signIn')}
          </Link>
        </>
      }
    >
      <ConfigurationWarning />
      {confirmationSent ? (
        <Alert tone="success" title={t('auth.checkEmailTitle')}>
          {t('auth.checkEmailBody')}
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label={t('auth.fullName')} error={fieldError('fullName')} required>
            {(p) => <Input {...p} autoComplete="name" {...form.register('fullName')} />}
          </Field>
          <Field label={t('auth.email')} error={fieldError('email')} required>
            {(p) => <Input {...p} type="email" autoComplete="email" dir="ltr" {...form.register('email')} />}
          </Field>
          <Field label={t('auth.password')} hint={t('auth.passwordHint')} error={fieldError('password')} required>
            {(p) => <Input {...p} type="password" autoComplete="new-password" dir="ltr" {...form.register('password')} />}
          </Field>
          <Field label={t('auth.confirmPassword')} error={fieldError('confirm')} required>
            {(p) => <Input {...p} type="password" autoComplete="new-password" dir="ltr" {...form.register('confirm')} />}
          </Field>
          <Button type="submit" variant="primary" loading={form.formState.isSubmitting} className="w-full">
            {t('auth.createAccount')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{ email: string }>({
    resolver: zodResolver(z.object({ email: z.string().trim().min(1, 'validation.required').email('validation.email') })),
    defaultValues: { email: '' },
  });

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setError(null);
    const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (authError) return setError(errorMessage(authError, t));
    setSent(true);
  });

  const message = form.formState.errors.email?.message;
  return (
    <AuthLayout
      title={t('auth.resetTitle')}
      subtitle={t('auth.resetSubtitle')}
      footer={
        <Link to="/login" className="font-medium text-accent hover:underline">
          {t('auth.backToSignIn')}
        </Link>
      }
    >
      {sent ? (
        <Alert tone="success" title={t('auth.checkEmailTitle')}>
          {t('auth.resetSent')}
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label={t('auth.email')} error={message ? t(message) : null} required>
            {(p) => <Input {...p} type="email" autoComplete="email" dir="ltr" {...form.register('email')} />}
          </Field>
          <Button type="submit" variant="primary" loading={form.formState.isSubmitting} className="w-full">
            {t('auth.sendResetLink')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const schema = z
    .object({ password: z.string().min(8, 'validation.passwordLength'), confirm: z.string() })
    .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'validation.passwordMatch' });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } });

  const onSubmit = form.handleSubmit(async ({ password }) => {
    setError(null);
    const { error: authError } = await supabase.auth.updateUser({ password });
    if (authError) return setError(errorMessage(authError, t));
    navigate('/', { replace: true });
  });

  const fieldError = (name: 'password' | 'confirm') => {
    const message = form.formState.errors[name]?.message;
    return message ? t(message) : null;
  };

  return (
    <AuthLayout title={t('auth.newPasswordTitle')} subtitle={t('auth.newPasswordSubtitle')}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label={t('auth.password')} error={fieldError('password')} required>
          {(p) => <Input {...p} type="password" autoComplete="new-password" dir="ltr" {...form.register('password')} />}
        </Field>
        <Field label={t('auth.confirmPassword')} error={fieldError('confirm')} required>
          {(p) => <Input {...p} type="password" autoComplete="new-password" dir="ltr" {...form.register('confirm')} />}
        </Field>
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting} className="w-full">
          {t('auth.updatePassword')}
        </Button>
      </form>
    </AuthLayout>
  );
}
