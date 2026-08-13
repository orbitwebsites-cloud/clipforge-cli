import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return <main className="auth-shell"><a className="auth-brand" href="/">ClipForge <em>Cloud</em></a><SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" forceRedirectUrl="/dashboard" /></main>;
}
