import { DOCUMENT } from '@angular/common';
import { HttpResponse } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { SpApi } from '../../core/api/sp-api';

/** `attachment; filename="result-123-qa-comments.csv"` → `result-123-qa-comments.csv`. */
export function fileNameFrom(disposition: string | null, fallback: string): string {
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition ?? '');
  const name = match?.[1]?.trim();
  if (!name) return fallback;
  try {
    return decodeURIComponent(name).replace(/[\\/]/g, '_');
  } catch {
    return name.replace(/[\\/]/g, '_');
  }
}

/**
 * "Export comments" of the SP view: the CSV comes through the SP client (it needs the bearer, so a
 * plain link cannot fetch it), then the browser saves it through a short-lived object URL.
 * Reporting's iframe must allow downloads (contract § 3).
 */
@Service()
export class SpCsvDownload {
  private readonly api = inject(SpApi);
  private readonly document = inject(DOCUMENT);

  /** Resolves when the file was handed to the browser; rejects with an `ApiError`. */
  async download(timelineId: number, resultCode: number, programId: number | null): Promise<void> {
    const response: HttpResponse<Blob> = await firstValueFrom(this.api.commentsCsv(timelineId, resultCode, programId));
    const blob = response.body ?? new Blob([], { type: 'text/csv' });
    const name = fileNameFrom(response.headers.get('Content-Disposition'), `result-${resultCode}-qa-comments.csv`);
    const url = URL.createObjectURL(blob);
    const link = this.document.createElement('a');
    link.href = url;
    link.download = name;
    link.rel = 'noopener';
    link.style.display = 'none';
    this.document.body.appendChild(link);
    try {
      link.click();
    } finally {
      link.remove();
      // Give the browser a tick to start the download before the URL goes away.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }
}
