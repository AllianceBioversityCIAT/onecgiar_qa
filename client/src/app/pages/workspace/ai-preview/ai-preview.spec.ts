import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Route, UrlSegment, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { AiSuggestionsApi } from '../../../core/api/ai-suggestions-api';
import { APP_CONFIG } from '../../../core/config/app-config';
import { ProductionEnvironment } from '../../../../environments/environment.model';
import { environment as development } from '../../../../environments/environment.development';
import { environment as qatest } from '../../../../environments/environment.qatest';
import { routes } from '../../../app.routes';
import { AiPreviewPage } from './ai-preview';
import { aiPreviewMatch } from './ai-preview.guard';

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
  it('is on in development and test; production cannot turn it on (a compile error)', () => {
    // The tests build with the test environment file, so production is checked by its type: if
    // ProductionEnvironment ever accepted `true`, this directive would be unused and the build would fail.
    const production: ProductionEnvironment = {
      name: 'production',
      apiBaseUrl: 'https://api.test/api/v1',
      ssoCallbackPath: '/auth/callback',
      // @ts-expect-error aiPreview: true never compiles in production
      aiPreview: true,
    };
    expect(production.name).toBe('production');
    expect(development.aiPreview).toBe(true);
    expect(qatest.aiPreview).toBe(true);
  });

  it('the route does not match when the flag is off or absent', () => {
    expect(match({ ...base, aiPreview: false })).toBe(false);
    TestBed.resetTestingModule();
    expect(match(base)).toBe(false);
    TestBed.resetTestingModule();
    expect(match({ ...base, aiPreview: true })).toBe(true);
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
