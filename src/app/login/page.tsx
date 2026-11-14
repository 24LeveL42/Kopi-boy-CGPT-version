import { LoginForm } from "@/components/LoginForm";

/** /auth/callback sends a failed Google sign-in back here as ?error=auth-failed. */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return <LoginForm authFailed={error === "auth-failed"} />;
}
