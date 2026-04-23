"use client";

import NotificationsBell from "./NotificationsBell";

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  /** Iniziali avatar (da sessione utente). */
  avatarInitials?: string;
};

export default function PageHeader({
  title,
  subtitle,
  avatarInitials = "??",
}: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-[28px] md:text-[32px] font-semibold tracking-tight">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-[14px] text-[color:var(--color-muted-foreground)]">
            {subtitle}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <NotificationsBell />
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#5e5ce6] to-[#0a84ff] text-[12px] font-semibold text-white"
          aria-hidden
        >
          {avatarInitials.slice(0, 3)}
        </div>
      </div>
    </header>
  );
}
