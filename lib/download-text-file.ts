/**
 * Download nel browser (solo client). No-op in SSR.
 */
export function downloadTextFile(
  filename: string,
  content: string,
  mime = "text/csv;charset=utf-8;"
): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
