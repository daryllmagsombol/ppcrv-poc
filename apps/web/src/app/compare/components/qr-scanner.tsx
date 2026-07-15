'use client';

import { useEffect, useRef, useCallback } from 'react';

interface QRScannerProps {
  onScan: (decodedText: string) => void;
  onError?: (error: string) => void;
  scanning: boolean;
}

export function QRScanner({ onScan, onError, scanning }: QRScannerProps) {
  const scannerRef = useRef<any>(null);

  const startScanner = useCallback(async () => {
    if (typeof window === 'undefined') return;

    try {
      const { Html5Qrcode } = await import('html5-qrcode');

      // Clean up any previous instance
      const existing = document.getElementById('qr-scanner-container');
      if (existing) {
        existing.innerHTML = '';
      }

      const scanner = new Html5Qrcode('qr-scanner-container');
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
        },
        (decodedText: string) => {
          scanner.pause();
          onScan(decodedText);
        },
        () => {
          // ignore unsuccessful reads
        },
      );
    } catch (err: any) {
      onError?.(err?.message || 'Camera access denied');
    }
  }, [onScan, onError]);

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        await scannerRef.current.clear();
      } catch {
        // ignore cleanup errors
      }
      scannerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (scanning) {
      startScanner();
    } else {
      stopScanner();
    }
    return () => {
      stopScanner();
    };
  }, [scanning, startScanner, stopScanner]);

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        id="qr-scanner-container"
        className="overflow-hidden rounded-lg border-2 border-[#1B3A5C] bg-black"
        style={{ width: 300, height: 300 }}
      />
      <p className="text-sm text-gray-500">
        Point camera at QR code on VCM receipt
      </p>
    </div>
  );
}
