/** @jsxImportSource react */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { copyTextToClipboard } from "@/lib/clipboard";
import { t } from "../../../i18n";

export function SignInFallbackNotice({ url }: { url: string }) {
  // Presentation-only copy feedback; DenSignInSurface stays stateless.
  const [copied, setCopied] = useState(false);

  const copyLink = () => {
    void copyTextToClipboard(url).then((copied) => {
      if (!copied) {
        console.error("[den-auth] failed to copy sign-in link");
        return;
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="rounded-xl border border-dls-border bg-dls-surface px-3 py-2 text-xs text-dls-secondary">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div>{t("den.browser_open_failed_hint")}</div>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="block break-all font-mono text-[11px] text-blue-11 underline underline-offset-2"
          >
            {url}
          </a>
        </div>
        <Button variant="outline" size="sm" onClick={copyLink}>
          {copied ? t("den.signin_link_copied") : t("den.copy_signin_link")}
        </Button>
      </div>
    </div>
  );
}
