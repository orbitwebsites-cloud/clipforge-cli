import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return <main className="auth-shell"><a className="auth-brand" href="/">ClipForge <em>Cloud</em></a><SignUp routing="path" path="/sign-up" signInUrl="/sign-in" forceRedirectUrl="/dashboard" /></main>;
}
