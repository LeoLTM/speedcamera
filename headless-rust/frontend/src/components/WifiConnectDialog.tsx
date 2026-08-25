import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wifi, Copy, Check, ExternalLink, Loader2 } from "lucide-react";

interface WifiConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ssid: string;
  password?: string;
  security?: string;
  connecting: boolean;
  assignedIp?: string | null;
}

export function WifiConnectDialog({
  open,
  onOpenChange,
  ssid,
  password,
  security,
  connecting,
  assignedIp,
}: WifiConnectDialogProps) {
  const [copied, setCopied] = useState(false);

  const isSecured = security && security !== "Open" && password && password.length > 0;
  const qrSecurityType = isSecured ? "WPA" : "nopass";
  const qrString = isSecured
    ? `WIFI:S:${ssid};T:${qrSecurityType};P:${password};;`
    : `WIFI:S:${ssid};T:nopass;;`;

  const targetUrl = assignedIp
    ? `http://${assignedIp}:3000`
    : "http://raspberrypi.local:3000";

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(targetUrl);
      setCopied(true);
      toast.success("Target URL copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy URL");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-full bg-primary/10 text-primary">
              <Wifi className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">
                {connecting ? "Connecting to Network..." : "Switched to Client Mode"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {connecting
                  ? "Configuring interface and establishing connection."
                  : "Device is connecting to your Wi-Fi network."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {connecting ? (
            <div className="flex flex-col items-center justify-center py-6 space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <div className="text-center space-y-1">
                <p className="text-sm font-medium">Applying network settings...</p>
                <p className="text-xs text-muted-foreground font-mono">
                  Connecting to: {ssid}
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* QR Code Card */}
              <div className="flex flex-col items-center justify-center p-4 rounded-lg border border-border bg-card/50 space-y-3">
                <div className="p-3 bg-white rounded-lg shadow-sm">
                  <QRCodeSVG
                    value={qrString}
                    size={160}
                    level="M"
                    includeMargin={false}
                  />
                </div>
                <div className="text-center space-y-0.5">
                  <span className="text-xs font-medium text-foreground">
                    Scan with smartphone camera to connect
                  </span>
                  <p className="text-[11px] text-muted-foreground">
                    Automatically joins <strong className="text-foreground">{ssid}</strong>
                  </p>
                </div>
              </div>

              {/* Instructions */}
              <div className="space-y-2 text-xs">
                <div className="p-3 rounded-md bg-muted/40 border border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Target Network:</span>
                    <Badge variant="outline" className="font-mono text-[11px]">
                      {ssid}
                    </Badge>
                  </div>
                  {isSecured && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Password:</span>
                      <span className="font-mono text-[11px] text-foreground">
                        {password}
                      </span>
                    </div>
                  )}
                  {assignedIp && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Assigned IP:</span>
                      <span className="font-mono font-semibold text-[11px] text-primary">
                        {assignedIp}
                      </span>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5 pt-1">
                  <p className="text-muted-foreground text-[11px] leading-relaxed">
                    The standalone setup hotspot is now shutting down. Connect your phone or laptop to{" "}
                    <strong className="text-foreground">{ssid}</strong> and open the dashboard:
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 px-3 py-1.5 rounded-md border bg-background font-mono text-xs text-foreground truncate select-all">
                      {targetUrl}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5"
                      onClick={handleCopyUrl}
                    >
                      {copied ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-green-500" />
                          <span className="text-xs">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span className="text-xs">Copy</span>
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      className="h-8 gap-1.5"
                      asChild
                    >
                      <a href={targetUrl} target="_blank" rel="noreferrer">
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span className="text-xs">Open</span>
                      </a>
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Dismiss
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
