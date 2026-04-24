import { redirect } from "next/navigation";
import LogsClient from "./LogsClient";
import { isAdminUserEmail } from "@/lib/admin-auth";
import { getSessionUser } from "@/lib/supabase/server-session";

export const metadata = {
  title: "System logs · Dev",
};

export default async function AdminLogsPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login?next=%2Fadmin%2Flogs");
  }
  const email =
    user.email ??
    (user.user_metadata?.email as string | undefined) ??
    null;
  if (!isAdminUserEmail(email)) {
    redirect("/");
  }

  return (
    <div className="min-h-[100dvh] bg-black text-zinc-100">
      <LogsClient />
    </div>
  );
}
