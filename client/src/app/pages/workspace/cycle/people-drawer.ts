import { Component, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AssignableRole, TimelineUser } from '../../../core/api/cycles.models';
import { QaButtonImports, QaDrawerImports, QaLoadingImports, QaSelectImports, QaSelectOption, skeletonRows } from '../../../ui';
import { Timeline } from './cycle.mock';
import { TimelinePeople } from './timeline-people';
import { ROLE_SECTIONS, personName } from './timeline-people.logic';

/**
 * "People" drawer of a timeline: who works in it, per role (assessors, lead assessors, brokers, PPU),
 * with add and remove. Only people holding that role in Assessors can be picked.
 */
@Component({
  selector: 'qa-cycle-people-drawer',
  imports: [QaButtonImports, QaDrawerImports, QaLoadingImports, QaSelectImports, RouterLink],
  providers: [TimelinePeople],
  template: `
    <qa-drawer [(open)]="open" [title]="'People · ' + (timeline()?.name ?? '')" [subtitle]="subtitle()" width="720px">
      @if (open()) {
        @switch (people.state()) {
          @case ('error') {
            <section role="alert" class="flex flex-col items-start gap-1">
              <h3 class="m-0 text-(length:--fs-16) font-bold text-(--text)">We couldn't load the people of this timeline</h3>
              <p class="m-0 text-(length:--fs-14) text-(--text-3)">{{ people.loadError() }}</p>
              <button hlmBtn qaBtn tone="secondary" type="button" (click)="reload()" class="mt-3">Try again</button>
            </section>
          }
          @case ('ready') {
            @if (!canWrite()) {
              <p role="status" class="m-0 rounded-[8px] bg-(--surface-2) px-3 py-2 text-(length:--fs-13) text-(--text-3)">The cycle is closed: assignments can no longer change.</p>
            }
            @for (s of sections; track s.role; let i = $index) {
              <section [qaReveal]="i" class="flex flex-col gap-3" [attr.aria-labelledby]="'people-' + s.role">
                <div class="flex flex-col gap-0.5">
                  <h3 [id]="'people-' + s.role" class="m-0 flex items-baseline gap-2 text-(length:--fs-14) font-bold text-(--text)">
                    {{ s.title }}
                    <span class="font-(family-name:--qa-mono) text-(length:--fs-12) font-semibold text-(--text-muted) tabular-nums">{{ people.byRole()[s.role].length }}</span>
                  </h3>
                  <p class="m-0 text-(length:--fs-12) text-(--text-3)">{{ s.hint }}</p>
                </div>

                @if (people.byRole()[s.role].length) {
                  <ul class="m-0 flex list-none flex-col rounded-[10px] border border-(--border) p-0">
                    @for (u of people.byRole()[s.role]; track u.assignmentId; let last = $last) {
                      <li class="flex min-h-12 items-center gap-3 px-3 py-2" [class]="last ? '' : 'border-b border-(--surface-4)'">
                        <div class="flex min-w-0 flex-1 flex-col">
                          @if (name(u) !== u.email) {
                            <span class="truncate text-(length:--fs-14) font-medium text-(--text)" [title]="name(u)">{{ name(u) }}</span>
                            <span class="text-(length:--fs-12) break-all text-(--text-3)">{{ u.email }}</span>
                          } @else {
                            <!-- No name (SSO account): the email is the only identifier, so it wraps instead of being cut. -->
                            <span class="text-(length:--fs-14) font-medium break-all text-(--text)">{{ u.email }}</span>
                          }
                        </div>
                        @if (canWrite()) {
                          <button
                            hlmBtn
                            qaBtn
                            tone="secondary"
                            size="sm"
                            type="button"
                            [loading]="people.isRemoving(u)"
                            (click)="remove(u)"
                            [attr.aria-label]="'Remove ' + name(u) + ' from ' + s.title"
                          >Remove</button>
                        }
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="m-0 rounded-[10px] border border-dashed border-(--border) px-3 py-3 text-(length:--fs-13) text-(--text-3)">No one assigned yet.</p>
                }

                @let options = optionsFor(s.role);
                @if (canWrite()) {
                  <div class="flex flex-wrap items-end gap-2">
                    <qa-select
                      [value]="picked()[s.role] ?? null"
                      (valueChange)="pick(s.role, $event)"
                      [options]="options"
                      [label]="'Add to ' + s.title"
                      [placeholder]="options.length ? 'Choose a person' : 'No one else holds this role'"
                      [disabled]="!options.length"
                      searchable
                      searchPlaceholder="Search by name or email"
                      panelWidth="420px"
                      class="min-w-0 flex-[1_1_16rem]"
                    />
                    <button
                      hlmBtn
                      qaBtn
                      tone="primary"
                      type="button"
                      [loading]="people.isAdding(s.role)"
                      [disabled]="!picked()[s.role]"
                      (click)="add(s.role)"
                      class="max-sm:w-full"
                    >Add</button>
                  </div>
                }
                @if (canWrite() && !options.length) {
                  <p class="m-0 text-(length:--fs-12) text-(--text-3)">Only people with this role can be added. Give the role in <a routerLink="/assessors" class="font-semibold text-(--accent) underline underline-offset-2 outline-none focus-visible:shadow-(--focus-ring)">Assessors</a>.</p>
                }
                @if (people.roleError()[s.role]; as message) {
                  <p role="alert" class="m-0 text-(length:--fs-13) text-(--danger)">{{ message }}</p>
                }
              </section>
            }
          }
          @default {
            <!-- Same frame as the ready state: four role blocks with two rows and the picker. -->
            <qa-loading label="Loading the people of this timeline" class="flex flex-col gap-6">
              @for (b of skeletonBlocks; track b) {
                <div class="flex flex-col gap-3">
                  <qa-skeleton class="h-4 w-36" />
                  <qa-skeleton class="h-3 w-64 max-w-full" />
                  <div class="flex flex-col rounded-[10px] border border-(--border)">
                    @for (r of skeletonPeople; track r) {
                      <div class="flex min-h-12 items-center gap-3 px-3 py-2"><qa-skeleton class="h-3.5 w-48" /><qa-skeleton class="ml-auto h-8 w-20 rounded-[8px]" /></div>
                    }
                  </div>
                  <qa-skeleton class="h-9 w-full rounded-[8px]" />
                </div>
              }
            </qa-loading>
          }
        }
      }
      <div qaDrawerFooter class="contents">
        <button hlmBtn qaBtn tone="secondary" type="button" (click)="open.set(false)">Done</button>
      </div>
    </qa-drawer>
  `,
})
export class PeopleDrawer {
  readonly open = model(false);
  readonly timeline = input<Timeline | null>(null);
  readonly canWrite = input(true);
  /** Someone was added or removed: the view refreshes the timeline (its counts). */
  readonly changed = output<void>();

  protected readonly people = inject(TimelinePeople);
  protected readonly sections = ROLE_SECTIONS;
  protected readonly skeletonBlocks = skeletonRows(4);
  protected readonly skeletonPeople = skeletonRows(2);
  protected readonly name = personName;
  /** The person chosen in each role's picker, until "Add" runs. */
  protected readonly picked = signal<Partial<Record<AssignableRole, string>>>({});

  constructor() {
    // Every opening reads the server again: someone may have changed the team or the timeline meanwhile.
    effect(() => {
      const id = this.timeline()?.apiId;
      if (!this.open() || id == null) return;
      untracked(() => {
        this.picked.set({});
        void this.people.load(id);
      });
    });
  }

  protected subtitle(): string {
    return this.people.state() === 'ready' ? this.people.summary() : 'Who works in this timeline';
  }

  protected optionsFor(role: AssignableRole): readonly QaSelectOption[] {
    return this.people.candidates(role).map((u) => ({ value: String(u.id), label: personName(u), description: personName(u) === u.email ? undefined : u.email }));
  }

  protected pick(role: AssignableRole, value: string | null): void {
    this.picked.update((p) => ({ ...p, [role]: value ?? undefined }));
  }

  protected async add(role: AssignableRole): Promise<void> {
    const value = this.picked()[role];
    if (!value) return;
    const id = this.timeline()?.apiId;
    if (await this.people.assign(role, Number(value))) {
      // The drawer may show another timeline by now: keep what the admin picked there.
      if (this.timeline()?.apiId === id) this.pick(role, null);
      this.changed.emit();
    }
  }

  protected async remove(user: TimelineUser): Promise<void> {
    if (await this.people.remove(user)) this.changed.emit();
  }

  protected reload(): void {
    const id = this.timeline()?.apiId;
    if (id != null) void this.people.load(id);
  }
}
