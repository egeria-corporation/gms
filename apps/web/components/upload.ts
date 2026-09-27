// SPDX-License-Identifier: AGPL-3.0-only
// Client-side upload: ask the server for a short-lived signed URL, PUT the bytes, then confirm (scan).
export interface SignedTarget {
  uploadUrl: string;
  method: string;
  headers: Record<string, string>;
}

export async function putToSignedUrl(target: SignedTarget, file: File, onProgress?: (pct: number) => void): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(target.method || 'PUT', target.uploadUrl);
    for (const [k, v] of Object.entries(target.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}). Try again.`)));
    xhr.onerror = () => reject(new Error('The upload was interrupted. Check your connection and try again.'));
    xhr.send(file);
  });
}
