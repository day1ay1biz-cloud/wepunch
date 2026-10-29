"use client";

import { useEffect, useRef, useState } from "react";

type Props = { onCode: (text: string) => void; onClose: () => void };

type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorCtor = { new (opts: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> };

/**
 * Camera QR scanner. Uses the browser's BarcodeDetector where it exists
 * (Chrome on Android) and falls back to zxing (iPhone Safari, Firefox).
 * Calls onCode once with the first code it reads, then stops the camera.
 */
export function Scanner({ onCode, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let zxingStop: (() => void) | null = null;
    let frame = 0;

    const finish = (text: string) => {
      if (stopped) return;
      stopped = true;
      cleanup();
      onCode(text);
    };

    function cleanup() {
      cancelAnimationFrame(frame);
      zxingStop?.();
      stream?.getTracks().forEach((t) => t.stop());
    }

    async function start() {
      const video = videoRef.current!;
      const Native = (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
      const nativeQr = Native && (await Native.getSupportedFormats?.())?.includes("qr_code");

      try {
        if (nativeQr) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
          video.srcObject = stream;
          await video.play();
          const detector = new Native!({ formats: ["qr_code"] });
          const tick = async () => {
            if (stopped) return;
            try {
              const [hit] = await detector.detect(video);
              if (hit?.rawValue) return finish(hit.rawValue);
            } catch {
              // A frame that isn't ready yet; try the next one.
            }
            frame = requestAnimationFrame(tick);
          };
          tick();
        } else {
          const { BrowserQRCodeReader } = await import("@zxing/browser");
          const reader = new BrowserQRCodeReader();
          const controls = await reader.decodeFromConstraints({ video: { facingMode: "environment" } }, video, (result) => {
            if (result) finish(result.getText());
          });
          zxingStop = () => controls.stop();
          if (stopped) zxingStop();
        }
      } catch (err) {
        const name = (err as { name?: string }).name;
        setError(
          name === "NotAllowedError"
            ? "Camera access was blocked. Allow the camera for this site in your browser settings, or look the customer up by phone."
            : "Couldn't start the camera. Look the customer up by phone instead.",
        );
      }
    }

    start();
    return () => {
      stopped = true;
      cleanup();
    };
  }, [onCode]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        {/* Aiming guide */}
        <div className="pointer-events-none absolute inset-[15%] rounded-2xl border-4 border-white/80" />
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      <button type="button" onClick={onClose} className="text-sm underline">
        Cancel
      </button>
    </div>
  );
}
