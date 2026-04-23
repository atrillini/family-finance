import LogsClient from "./LogsClient";

export const metadata = {
  title: "System logs · Dev",
};

export default function AdminLogsPage() {
  return (
    <div className="min-h-[100dvh] bg-black text-zinc-100">
      <LogsClient />
    </div>
  );
}
