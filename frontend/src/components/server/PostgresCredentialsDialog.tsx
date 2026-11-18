import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PostgresCredential } from "@/types";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@maunting/ui'

interface Props {
  credentials: PostgresCredential[];
  onClose: () => void;
}

export function PostgresCredentialsDialog({ credentials, onClose }: Props) {
  const { t } = useTranslation();

  return (
    <Dialog open={credentials.length > 0} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="w-full max-w-2xl p-6">
        <DialogHeader className="p-0 pb-2">
          <DialogTitle className="font-headline text-headline-sm text-primary">
            {t("servers.postgres.credentialsTitle")}
          </DialogTitle>
          <DialogDescription className="text-sm mt-1">
            {t("servers.postgres.credentialsHint")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 my-4 max-h-[60vh] overflow-y-auto">
          {credentials.map((cred) => {
            const dsn = `postgresql://${cred.username}:${cred.password}@${cred.host}:${cred.port}/${cred.database_name}`;
            return (
              <div key={`${cred.database_name}-${cred.username}`} className="rounded-lg border border-outline-variant bg-surface-container p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-sm text-on-surface">
                  <div>{t("databases.database")}: {cred.database_name}</div>
                  <div>{t("databases.user")}: {cred.username}</div>
                  <div>{t("databases.host")}: {cred.host}</div>
                  <div>{t("databases.port")}: {cred.port}</div>
                  <div className="md:col-span-2">{t("common.password")}: {cred.password}</div>
                  <div className="md:col-span-2 break-all">
                    {t("databases.connectionUrl")}: {dsn}
                  </div>
                </div>
                <Button variant="secondary"
                  type="button"
                  className="mt-3 inline-flex items-center gap-2"
                  onClick={() => navigator.clipboard.writeText(dsn)}
                >
                  <Copy className="w-4 h-4" />
                  {t("servers.postgres.copyDsn")}
                </Button>
              </div>
            );
          })}
        </div>
        <DialogFooter variant="plain" className="p-0 flex justify-end">
          <Button type="button" onClick={onClose}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
