'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface QRScannerProps {
  onScan: (decodedText: string) => void;
  onError?: (error: string) => void;
  scanning: boolean;
  /** When set, a QR has been detected and is awaiting user confirmation */
  detectedText?: string;
  /** Label for the confirm button (e.g. "Confirm & Next (Slot 2)") */
  confirmLabel?: string;
  /** Called when user confirms the detected QR */
  onConfirm?: () => void;
  /** Called when user rejects the detected QR to re-scan */
  onReject?: () => void;
  /** Called when user wants to go back to the previous slot */
  onBack?: () => void;
  /** Whether to show the back button (hide on slot 1) */
  showBack?: boolean;
}

function getFriendlyError(err: any): string {
  const name = err?.name || '';
  const message = err?.message || err?.toString() || 'Unknown camera error';

  if (name === 'NotAllowedError' || message.includes('permission')) {
    return 'Camera permission denied. Please allow camera access in your browser settings and refresh the page.';
  }
  if (name === 'NotFoundError' || message.includes('not found')) {
    return 'No camera found on this device. Please connect a camera and try again.';
  }
  if (name === 'NotReadableError' || message.includes('in use')) {
    return 'Camera is busy or in use by another app. Close other apps using the camera and try again.';
  }
  if (name === 'OverconstrainedError' || message.includes('constraint')) {
    return 'Camera does not support the requested resolution. Try a different device.';
  }
  if (name === 'SecurityError' || message.includes('security') || message.includes('HTTP')) {
    return 'Camera access requires a secure connection (HTTPS). This page must be served over HTTPS.';
  }
  return `Camera error: ${message}`;
}

export function QRScanner({
  onScan,
  onError,
  scanning,
  detectedText,
  confirmLabel,
  onConfirm,
  onReject,
  onBack,
  showBack,
}: QRScannerProps) {
  const scannerRef = useRef<any>(null);
  const torchOnRef = useRef(false);
  /** QR text that was already confirmed (ignore forever) */
  const lastConfirmedRef = useRef<string | undefined>(undefined);
  /** QR text that is currently pending confirmation (ignore while showing) */
  const pendingTextRef = useRef<string | undefined>(undefined);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const [torchSupported, setTorchSupported] = useState(false);
  const [scanState, setScanState] = useState<
    'stopped' | 'starting' | 'streaming'
  >('stopped');

  const toggleTorchInternal = useCallback(async (scanner: any) => {
    try {
      const caps = scanner.getRunningTrackCameraCapabilities();
      const torch = caps.torchFeature();
      if (torch.isSupported()) {
        if (torchOnRef.current) {
          await torch.apply(false);
          torchOnRef.current = false;
        } else {
          await torch.apply(true);
          torchOnRef.current = true;
        }
      }
    } catch {
      // torch not available
    }
  }, []);

  const stopScanner = useCallback(async () => {
    const s = scannerRef.current;
    scannerRef.current = null;
    if (s) {
      try {
        await s.stop();
        await s.clear();
      } catch {
        // ignore cleanup errors
      }
    }
    torchOnRef.current = false;
    setTorchSupported(false);
    setScanState('stopped');
  }, []);

  const startScanner = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (!mountedRef.current) return;

    const gen = ++generationRef.current;

    await stopScanner();
    if (!mountedRef.current || gen !== generationRef.current) return;

    setScanState('starting');

    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      if (!mountedRef.current || gen !== generationRef.current) return;

      const el = document.getElementById('qr-scanner-container');
      if (!el) return;
      el.innerHTML = '';

      const scanner = new Html5Qrcode('qr-scanner-container', {
        useBarCodeDetectorIfSupported: false,
        verbose: false,
      });
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 30,
          qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const size = Math.min(viewfinderWidth, viewfinderHeight) * 0.85;
            return { width: size, height: size };
          },
        },
        (decodedText: string) => {
          if (decodedText === lastConfirmedRef.current) return;
          if (decodedText === pendingTextRef.current) return;

          pendingTextRef.current = decodedText;
          onScan(decodedText);
        },
        () => {
          // ignore unsuccessful reads
        },
      );

      if (!mountedRef.current || gen !== generationRef.current) {
        stopScanner();
        return;
      }

      setScanState('streaming');

      try {
        const caps = scanner.getRunningTrackCameraCapabilities();
        const torch = caps.torchFeature();
        setTorchSupported(torch.isSupported());
      } catch {
        setTorchSupported(false);
      }
    } catch (err: any) {
      if (mountedRef.current && gen === generationRef.current) {
        onError?.(getFriendlyError(err));
      }
      setScanState('stopped');
    }
  }, [onScan, onError, toggleTorchInternal, stopScanner]);

  const toggleTorch = useCallback(async () => {
    const scanner = scannerRef.current;
    if (!scanner || scanState === 'stopped') return;
    await toggleTorchInternal(scanner);
  }, [scanState, toggleTorchInternal]);

  // Start/stop camera based on scanning prop
  useEffect(() => {
    mountedRef.current = true;
    if (scanning) {
      startScanner();
    } else {
      stopScanner();
    }
    return () => {
      mountedRef.current = false;
      generationRef.current++;
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  // Sync pendingTextRef in an effect (reactive to prop changes)
  const prevDetectedRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    prevDetectedRef.current = detectedText;
    pendingTextRef.current = detectedText;
  }, [detectedText]);

  /** Wrapper: only set lastConfirmedRef on explicit user confirmation. */
  const handleConfirm = useCallback(() => {
    if (pendingTextRef.current) {
      lastConfirmedRef.current = pendingTextRef.current;
    }
    onConfirm?.();
  }, [onConfirm]);

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Viewfinder + overlay */}
      <div className="relative w-full max-w-sm">
        <div
          id="qr-scanner-container"
          className="qr-viewfinder overflow-hidden rounded-lg border-2 border-ink bg-black"
          style={{ width: '100%', aspectRatio: '1 / 1', minHeight: '280px' }}
        />

        {/* Spinner overlay — shown while camera is starting */}
        {scanState === 'starting' && !detectedText && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-black/50">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-field border-t-ballot" />
          </div>
        )}

        {/* Confirmation overlay — shown when QR is detected */}
        {detectedText && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-lg bg-green-50/95 p-4">
            <p className="text-sm font-semibold text-green-700">
              ✓ QR Code Detected
            </p>
            <div className="max-w-full overflow-hidden rounded bg-white px-3 py-2">
              <p className="truncate text-xs font-mono text-gray-600">
                {detectedText.length > 80
                  ? detectedText.slice(0, 80) + '...'
                  : detectedText}
              </p>
              <p className="mt-0.5 text-center text-[10px] text-gray-400">
                {detectedText.length} chars
              </p>
            </div>
            {/* Action buttons — single row */}
            <div className="flex items-center justify-center gap-2">
              {showBack && (
                <button
                  onClick={onBack}
                  className="rounded-lg border border-gray-400 px-3 py-2 text-sm text-gray-600 transition hover:bg-gray-100 min-w-[44px] min-h-[44px]"
                  type="button"
                  aria-label="Go back to previous QR slot"
                >
                  ← Back
                </button>
              )}
              <button
                onClick={handleConfirm}
                className="rounded-lg bg-green-700 px-5 py-2 text-sm font-semibold text-white transition hover:bg-green-800 min-w-[44px] min-h-[44px]"
                type="button"
              >
                {confirmLabel || 'Confirm'}
              </button>
              <button
                onClick={onReject}
                className="rounded-lg border border-gray-400 px-3 py-2 text-sm text-gray-600 transition hover:bg-gray-100 min-w-[44px] min-h-[44px]"
                type="button"
              >
                Re-scan
              </button>
            </div>
          </div>
        )}

        {/* Torch button */}
        {torchSupported && scanState === 'streaming' && (
          <button
            onClick={toggleTorch}
            className="absolute bottom-3 right-3 z-20 rounded-full bg-black/60 p-2 text-white backdrop-blur-sm transition hover:bg-black/80"
            aria-label="Toggle flashlight"
            type="button"
          >
            <svg
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </button>
        )}
      </div>

      <style>{`
        .qr-viewfinder {
          position: relative;
        }
        .qr-viewfinder video {
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          width: 100% !important;
          height: 100% !important;
          object-fit: cover !important;
        }
      `}</style>

      {/* Status text */}
      {(scanState === 'starting' || scanState === 'streaming') && (
        <p role="status" className="text-sm text-gray-500">
          {scanState === 'starting' && !detectedText && 'Starting camera...'}
          {scanState === 'streaming' && !detectedText &&
            'Point camera at QR code on VCM receipt'}
        </p>
      )}
    </div>
  );
}
