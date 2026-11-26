import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { setupSpTesting } from '../../core/sp/sp-testing';
import { SpCommentThread } from './sp-comment-thread';
import { spComment } from './sp-fixtures';

describe('SpCommentThread', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<SpCommentThread>;

  const ask = {
    id: 10,
    kind: 'request_clarification' as const,
    body: 'Which part?',
    respondedBy: { name: 'Sam Program' },
    respondedAt: '2026-11-17T10:00:00.000Z',
  };
  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const formShown = () =>
    (fixture.nativeElement as HTMLElement).querySelector('input[type=radio][value=accept]') !==
    null;

  beforeEach(() => {
    http = setupSpTesting(undefined, [], []);
    fixture = TestBed.createComponent(SpCommentThread);
    fixture.componentRef.setInput('writable', true);
  });
  afterEach(() => http.verify());

  it('opens the form when the assessor answers while the page stays open (same response, new state)', () => {
    fixture.componentRef.setInput(
      'comment',
      spComment({
        state: 'clarification_requested',
        response: ask,
        history: [ask],
        clarifications: [
          { requestId: 10, question: 'Which part?', requestedAt: ask.respondedAt, answer: null },
        ],
      }),
    );
    fixture.detectChanges();
    expect(text()).toContain('Clarification requested');
    expect(formShown()).toBe(false);

    fixture.componentRef.setInput(
      'comment',
      spComment({
        state: 'open',
        response: ask,
        history: [ask],
        clarifications: [
          {
            requestId: 10,
            question: 'Which part?',
            requestedAt: ask.respondedAt,
            answer: { body: 'The second sentence.', answeredAt: '2026-11-18T10:00:00.000Z' },
          },
        ],
      }),
    );
    fixture.detectChanges();
    expect(text()).toContain('Clarification answered');
    expect(formShown()).toBe(true);
  });
});
