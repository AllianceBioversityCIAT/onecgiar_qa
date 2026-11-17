import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Route, UrlSegment, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { AiSuggestionsApi } from '../../../core/api/ai-suggestions-api';
import { APP_CONFIG } from '../../../core/config/app-config';
import { routes } from '../../../app.routes';
import { AiPreviewPage } from './ai-preview';
import { AI_PREVIEW } from './ai-preview.flag';
import { aiPreviewMatch, aiPreviewOn } from './ai-preview.guard';

const base = {
  name: 'test' as const,
  apiBaseUrl: 'https://api.test/api/v1',
  ssoCallbackPath: '/auth/callback',
};

function match(config: object): unknown {
  TestBed.configureTestingModule({ providers: [{ provide: APP_CONFIG, useValue: config }] });
  return TestBed.runInInjectionContext(() =>
    aiPreviewMatch({} as Route, [] as UrlSegment[], {} as never),
  );
}

describe('AI preview (plan B, P2-3918)', () => {
  it('is on in the build the tests run with (development swaps in ai-preview.flag.on.ts)', () => {
    // The production value is `ai-preview.flag.ts`, typed `false`: setting it to true is a compile
    // error, so a production build fails (checked by hand, see the spec's execution log).
    expect(AI_PREVIEW).toBe(true);
  });

  it('never opens where the environment says production, whatever the build flag', () => {
    expect(aiPreviewOn(true, 'production')).toBe(false);
    expect(aiPreviewOn(false, 'test')).toBe(false);
    expect(aiPreviewOn(false, 'development')).toBe(false);
    expect(aiPreviewOn(true, 'test')).toBe(true);
    expect(aiPreviewOn(true, 'development')).toBe(true);
  });

  it('the route guard reads the environment name', () => {
    expect(match({ ...base, name: 'production' })).toBe(false);
    TestBed.resetTestingModule();
    expect(match(base)).toBe(true);
  });

  it('is registered behind the flag guard, under the signed-in shell', () => {
    const shell = routes.find((r) =>
      r.children?.some((c) => c.path === 'ai-preview/:timelineId/:resultCode'),
    );
    const route = shell!.children!.find((c) => c.path === 'ai-preview/:timelineId/:resultCode')!;
    expect(route.canMatch).toContain(aiPreviewMatch);
    expect(shell!.canActivate?.length).toBeGreaterThan(0);
  });

  it('lists the chips of the result read only, with the field names', async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ timelineId: '3', resultCode: '5001' })) },
        },
        {
          provide: AiSuggestionsApi,
          useValue: {
            list: () =>
              of([
                {
                  status: 'available',
                  valueKind: 'level',
                  fieldKey: 'general.gender_tag',
                  suggestionId: 's',
                  signal: 'red',
                  suggestedValue: 0,
                  explanation: 'No activity targets gender.',
                  evidenceQuote: '',
                  quoteVerified: false,
                  evidenceSource: null,
                  promptVersion: 'v',
                  modelId: 'm',
                },
                { status: 'pending', fieldKey: 'general.climate_tag' },
              ]),
            sendEvent: () => of(undefined),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(AiPreviewPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('result 5001');
    expect(text).toContain('Gender equality, youth and social inclusion tag');
    expect(text).toContain('Review');
    expect(text).toContain('Suggestion in progress');
    expect(text).not.toContain('Copy to comment');
  });
});
