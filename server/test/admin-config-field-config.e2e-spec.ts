import request from 'supertest';
import { GRANTABLE_ROLES } from '../src/users/permissions.js';
import {
  bearer,
  buildAdminConfigApp,
  type AdminConfigApp,
} from './support/admin-config-app.js';
import { LogSpy } from './support/log-spy.js';

// Field configuration over the real app (field-configuration T-9): the HTTP side
// of FR-1 (admin only), FR-2 and FR-3 (the view), FR-4 and FR-5 (the draft edit),
// FR-6 (discard), FR-7 (preview), FR-8 (publish, stale, nothing to publish, two
// at once, replay), FR-11 (audit), FR-12 (versions never change), FR-13 (closed
// and unknown cycle), NFR-1, NFR-2, NFR-3 (the fake's lock order), NFR-5 (one
// catalog read per request), NFR-7 and NFR-8. The guards, the pipe, the filter,
// the idempotency interceptor and OpenAPI are real; the stores, the Reporting
// catalog (the T-2 fixture) and the clocks are the in-memory world (today in
// Rome is 2026-10-20). Expected values are the spec's, written out.
//
// Every refusal goes through `refused`: it reads the whole view of the cycle
// before, sends the request, expects the error, reads the whole view again and
// expects it equal, and expects the stored state (every field-config table and
// the write log) equal.

const NON_ADMINS = [
  'ASSESSOR',
  'LEAD_ASSESSOR',
  'TPB',
  'PPU',
  'GUEST',
  'MULTI_GRANT',
] as const;

const TYPES = [
  'policy_change',
  'innovation_use',
  'other_outcome',
  'capacity_sharing',
  'knowledge_product',
  'innovation_development',
  'other_output',
  'impact_contribution',
  'innovation_package',
];

const ASSESSED = { visibility: 'assessed', isCore: true, isAiInput: true };
const item = (
  resultTypeKey: string,
  fieldKey: string,
  option: Record<string, unknown> = ASSESSED,
) => ({ resultTypeKey, fieldKey, ...option });
const OFF = { visibility: 'hidden', isCore: false, isAiInput: false };

function expectError(res: request.Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.body).toMatchObject({
    success: false,
    error: { status, code },
    meta: { requestId: res.headers['x-request-id'] },
  });
}

const fieldsOf = (res: request.Response): Array<[string, string]> =>
  (res.body.error.fields as Array<{ field: string; code: string }>).map(
    ({ field, code }) => [field, code],
  );

type FieldNode = {
  key: string;
  unclassified: boolean;
  draft: Record<string, unknown>;
  published: Record<string, unknown> | null;
  requirement: string;
  isNew: boolean;
};
const fieldOf = (
  data: {
    resultTypes: Array<{
      key: string;
      sections: Array<{ fields: FieldNode[] }>;
    }>;
  },
  type: string,
  key: string,
): FieldNode => {
  const found = data.resultTypes
    .find((t) => t.key === type)
    ?.sections.flatMap((s) => s.fields)
    .find((f) => f.key === key);
  if (found === undefined) throw new Error(`${type}.${key} is not in the view`);
  return found;
};

describe('Field configuration routes (e2e)', () => {
  let w: AdminConfigApp;
  let spy: LogSpy;

  beforeEach(async () => {
    w = await buildAdminConfigApp();
    spy = new LogSpy();
    spy.attach();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    spy.detach();
    await w.app.close();
  });

  const createCycle = async (year: number) => {
    const res = await w.send('post', '/cycles', { body: { year } });
    expect(res.status, `create cycle ${year}`).toBe(201);
    return res.body.data.id as number;
  };
  const activateCycle = async (id: number) => {
    const res = await w.send('post', `/cycles/${id}/activate`);
    expect(res.status, `activate ${id}`).toBe(200);
  };
  const view = (id: number, token?: string | null) =>
    w.send(
      'get',
      `/cycles/${id}/field-config`,
      token === undefined ? {} : { token },
    );
  const patch = (
    id: number,
    items: unknown[],
    options: { token?: string | null } = {},
  ) =>
    w.send('patch', `/cycles/${id}/field-config/draft`, {
      body: { items },
      ...options,
    });
  const discard = (id: number) =>
    w.send('delete', `/cycles/${id}/field-config/draft`);
  const preview = (id: number) =>
    w.send('get', `/cycles/${id}/field-config/publish-preview`);
  const publish = (
    id: number,
    revision: unknown,
    options: { key?: string; token?: string | null } = {},
  ) =>
    w.send('post', `/cycles/${id}/field-config/publish`, {
      body: { revision },
      ...options,
    });
  /** Edit then publish: the cycle gets its next version; answers the publish. */
  const edit = async (id: number, items: unknown[]) => {
    const edited = await patch(id, items);
    expect(edited.status, 'edit').toBe(200);
    const done = await publish(id, edited.body.data.revision);
    expect(done.status, 'publish').toBe(201);
    return done;
  };
  const revisionOf = async (id: number) =>
    (await view(id)).body.data.revision as number;

  /** Every field-config table and the write log, as one string: equal strings = nothing stored, nothing written. */
  const stored = () =>
    JSON.stringify([
      w.fieldConfigWorld.drafts,
      w.fieldConfigWorld.draftItems,
      w.fieldConfigWorld.versions,
      w.fieldConfigWorld.versionItems,
      w.fieldConfigWorld.auditEvents,
      w.fieldConfigWorld.writeLog,
    ]);
  /** The whole view of a cycle, read while Reporting answers. */
  const wholeView = async (id: number) => {
    const res = await view(id);
    expect(res.status, 'whole view').toBe(200);
    return res.body.data as unknown;
  };
  const expectViewUnchanged = async (id: number, before: unknown) => {
    const after = await wholeView(id);
    expect(after).toEqual(before);
  };
  /**
   * A refusal with its two proofs. `watch` is the cycle whose whole view is read
   * before and after; `around` flips a Reporting switch for the request only.
   */
  const refused = async (
    watch: number,
    call: () => Promise<request.Response>,
    status: number,
    code: string,
    around?: { on: () => void; off: () => void },
  ) => {
    const viewBefore = await wholeView(watch);
    const storedBefore = stored();
    around?.on();
    let res: request.Response;
    try {
      res = await call();
    } finally {
      around?.off();
    }
    expectError(res, status, code);
    await expectViewUnchanged(watch, viewBefore);
    expect(stored()).toBe(storedBefore);
    return res;
  };
  const catalogDown = {
    on: () => void (w.fieldCatalogs.down = true),
    off: () => void (w.fieldCatalogs.down = false),
  };
  const catalogMissing = (year: number) => ({
    on: () => void w.fieldCatalogs.missingYears.add(year),
    off: () => void w.fieldCatalogs.missingYears.delete(year),
  });
  /** Cycle 2026 closed with a version and a draft: 2027 is activated over it. */
  const closedCycle = async () => {
    const id = await createCycle(2026);
    await activateCycle(id);
    await edit(id, [item('policy_change', 'general.title')]);
    await patch(id, [item('policy_change', 'policy_change.policy_type')]);
    await activateCycle(await createCycle(2027));
    return id;
  };
  /** A timeline row with its first step and result types (the preview reads these). */
  const seedTimeline = (
    id: number,
    cycleId: number,
    opensOn: string,
    types: string[] | 'all',
  ) => {
    w.world.timelines.push({
      id,
      cycleId,
      name: `Timeline ${id}`,
      kind: id === 1 ? 'official' : 'additional',
      officialKey: id === 1 ? cycleId : null,
      allPrograms: true,
      allResultTypes: types === 'all',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      createdBy: w.admin.id,
      version: 1,
      updatedAt: null,
      updatedBy: null,
    });
    w.world.steps.push({
      id: id * 10,
      timelineId: id,
      position: 1,
      name: 'QA Platform open for assessors',
      audience: 'assessors',
      opensOn,
      closesOn: '2026-12-18',
      round: 1,
      requiresLoad: false,
    });
    if (types !== 'all') {
      for (const key of types) {
        w.world.resultTypes.push({ timelineId: id, resultTypeKey: key });
      }
    }
  };
  const days = (n: number) => n * 24 * 60 * 60 * 1000;

  // --- FR-1, NFR-1: every route is admin only --------------------------------

  describe('FR-1: access', () => {
    type Route = [
      'view' | 'edit' | 'discard' | 'preview' | 'publish',
      'get' | 'patch' | 'delete' | 'post',
      string,
      object?,
    ];
    const ROUTES: Route[] = [
      ['view', 'get', '/cycles/1/field-config'],
      [
        'edit',
        'patch',
        '/cycles/1/field-config/draft',
        { items: [item('policy_change', 'general.title')] },
      ],
      ['discard', 'delete', '/cycles/1/field-config/draft'],
      ['preview', 'get', '/cycles/1/field-config/publish-preview'],
      ['publish', 'post', '/cycles/1/field-config/publish', { revision: 0 }],
    ];

    it('has a 403 row for every grantable role (a new role without one fails here)', () => {
      const covered = new Set<string>(['ADMIN', ...NON_ADMINS]);
      for (const { code } of GRANTABLE_ROLES) {
        expect(covered.has(code), `no 403 row for ${code}`).toBe(true);
      }
    });

    it.each(ROUTES)(
      '%s: 401 without a token and with a token that is not valid',
      async (_name, method, path, payload) => {
        await createCycle(2026);

        for (const token of [null, 'Bearer not-a-token']) {
          await refused(
            1,
            () =>
              w.send(method, path, {
                token,
                ...(payload ? { body: payload } : {}),
              }),
            401,
            'AUTH_TOKEN_INVALID',
          );
        }
      },
    );

    for (const role of NON_ADMINS) {
      it.each(ROUTES)(
        `%s: ${role} gets 403 AUTH_PERMISSION_DENIED and nothing is read or written`,
        async (_name, method, path, payload) => {
          await createCycle(2026);
          const requestedBefore = [...w.fieldCatalogs.requested];

          await refused(
            1,
            () =>
              w.send(method, path, {
                token: bearer(`sub-${role.toLowerCase()}`),
                ...(payload ? { body: payload } : {}),
              }),
            403,
            'AUTH_PERMISSION_DENIED',
          );

          // The guard answers before the cycle or the catalog is looked at.
          expect(w.fieldCatalogs.requested).toEqual([
            ...requestedBefore,
            // the two whole-view reads of `refused` are the only catalog reads
            ...Array(2).fill(2026),
          ]);
        },
      );
    }

    it('FR-1 and FR-8: a keyed publish refused for no token or for a non-admin reserves no idempotency key and records nothing', async () => {
      const id = await createCycle(2026);
      const edited = await patch(id, [item('policy_change', 'general.title')]);
      const revision = edited.body.data.revision;
      const rows = stored();

      const statuses: number[] = [];
      for (const token of [null, 'Bearer not-a-token', bearer('sub-ppu')]) {
        const res = await publish(id, revision, { key: 'denied-1', token });
        statuses.push(res.status);
      }
      expect(statuses).toEqual([401, 401, 403]);

      expect(w.db.idempotency).toHaveLength(0);
      expect(stored()).toBe(rows);
      // the same key is still free for the admin: it creates version 1
      const admin = await publish(id, revision, { key: 'denied-1' });
      expect(admin.status).toBe(201);
      expect(admin.headers['idempotency-replayed']).toBeUndefined();
    });

    it.each(ROUTES)(
      '%s: a non-admin gets the same 403 for a cycle that exists and one that does not',
      async (_name, method, path, payload) => {
        await createCycle(2026);
        const send = (p: string) =>
          w.send(method, p, {
            token: bearer('sub-assessor'),
            ...(payload ? { body: payload } : {}),
          });

        const known = await refused(
          1,
          () => send(path),
          403,
          'AUTH_PERMISSION_DENIED',
        );
        const unknown = await refused(
          1,
          () => send(path.replace('/cycles/1/', '/cycles/99/')),
          403,
          'AUTH_PERMISSION_DENIED',
        );

        expect(unknown.body.error).toEqual(known.body.error);
      },
    );
  });

  // --- FR-2, FR-3: the view ---------------------------------------------------

  describe('FR-2 and FR-3: the view', () => {
    it('lists the catalog of the cycle: nine types in catalog order, a field reads unclassified and hidden, nothing published', async () => {
      const id = await createCycle(2026);

      const res = await view(id);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true });
      const data = res.body.data;
      expect(data).toMatchObject({
        cycleId: id,
        year: 2026,
        catalogVersion: '2026.30',
        revision: 0,
        latestVersion: null,
        notInCatalog: [],
      });
      expect(data.resultTypes.map((t: { key: string }) => t.key)).toEqual(
        TYPES,
      );
      expect(data.resultTypes[0]).toMatchObject({
        key: 'policy_change',
        label: 'Policy change',
        level: 'outcome',
      });
      // sections in the catalog's order, fields in the catalog's order
      expect(
        data.resultTypes[0].sections
          .slice(0, 3)
          .map((s: { key: string }) => s.key),
      ).toEqual([
        'general_information',
        'contributors_partners',
        'geographic_location',
      ]);
      expect(
        data.resultTypes[0].sections[0].fields
          .slice(0, 2)
          .map((f: FieldNode) => f.key),
      ).toEqual(['general.result_level', 'general.result_type']);
      // "*" fields are under every type; a type-only field under its type alone
      for (const type of TYPES) {
        expect(fieldOf(data, type, 'general.title').requirement).toBe(
          'required',
        );
      }
      expect(() =>
        fieldOf(data, 'knowledge_product', 'policy_change.policy_type'),
      ).toThrow();
      expect(
        fieldOf(data, 'policy_change', 'policy_change.policy_type'),
      ).toBeDefined();
      expect(
        fieldOf(data, 'policy_change', 'general.description').requirement,
      ).toBe('conditional');
      // FR-3: unclassified reads hidden, no core, no AI input; nothing published
      expect(fieldOf(data, 'policy_change', 'general.title')).toMatchObject({
        unclassified: true,
        draft: OFF,
        published: null,
        isNew: false,
      });
    });

    it('reads the catalog of the year of the cycle, once per request', async () => {
      await createCycle(2026);
      const id = await createCycle(2027);

      const res = await view(id);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ cycleId: id, year: 2027 });
      expect(w.fieldCatalogs.requested).toEqual([2027]);
    });

    it('a cycle whose year has no catalog is 409 FIELD_CONFIG_CATALOG_MISSING, never an empty list', async () => {
      await createCycle(2026);
      const id = await createCycle(2027);

      const res = await refused(
        id,
        () => view(id),
        409,
        'FIELD_CONFIG_CATALOG_MISSING',
        catalogMissing(2027),
      );

      expect(res.body.data).toBeUndefined();
    });

    it('Reporting down is 503 SERVICE_UNAVAILABLE, distinct from the missing catalog', async () => {
      const id = await createCycle(2026);

      await refused(
        id,
        () => view(id),
        503,
        'SERVICE_UNAVAILABLE',
        catalogDown,
      );
    });

    it('shows a draft option set the catalog no longer lists apart, as "not in catalog"', async () => {
      const id = await createCycle(2026);
      w.fieldConfigWorld.drafts.push({
        cycleId: id,
        revision: 3,
        updatedAt: null,
        updatedBy: null,
      });
      w.fieldConfigWorld.draftItems.push({
        cycleId: id,
        resultTypeKey: 'policy_change',
        fieldKey: 'general.retired_field',
        visibility: 'assessed',
        isCore: true,
        isAiInput: false,
      });

      const res = await view(id);

      expect(res.body.data.revision).toBe(3);
      expect(res.body.data.notInCatalog).toEqual([
        {
          resultTypeKey: 'policy_change',
          fieldKey: 'general.retired_field',
          draft: { visibility: 'assessed', isCore: true, isAiInput: false },
        },
      ]);
    });

    it('answers 404 CYCLES_NOT_FOUND for an unknown cycle and 400 on `id` for one that is not a number', async () => {
      const id = await createCycle(2026);

      await refused(id, () => view(99), 404, 'CYCLES_NOT_FOUND');
      const malformed = await refused(
        id,
        () => w.send('get', '/cycles/abc/field-config'),
        400,
        'VALIDATION_FAILED',
      );

      expect(fieldsOf(malformed)).toEqual([['id', 'INVALID_TYPE']]);
    });

    it('answers in a closed cycle, and reads write nothing', async () => {
      const id = await closedCycle();
      const writes = [...w.fieldConfigWorld.writeLog];

      const res = await view(id);

      expect(res.status).toBe(200);
      expect(res.body.data.latestVersion).toMatchObject({ number: 1 });
      expect(w.fieldConfigWorld.writeLog).toEqual(writes);
    });
  });

  // --- FR-4, FR-5: the draft edit ---------------------------------------------

  describe('FR-5: PATCH the draft', () => {
    it('stores several items in one request, moves the revision by one and leaves the rest alone', async () => {
      const id = await createCycle(2026);
      await patch(id, [item('policy_change', 'policy_change.policy_type')]);
      const revision = await revisionOf(id);

      const res = await patch(id, [
        item('policy_change', 'general.title'),
        item('knowledge_product', 'general.title', {
          visibility: 'view_only',
        }),
        item('innovation_use', 'general.title', {
          visibility: 'assessed',
          isCore: true,
        }),
      ]);

      expect(res.status).toBe(200);
      expect(res.body.data.revision).toBe(revision + 1);
      expect(
        fieldOf(res.body.data, 'policy_change', 'general.title'),
      ).toMatchObject({
        unclassified: false,
        draft: ASSESSED,
      });
      expect(
        fieldOf(res.body.data, 'knowledge_product', 'general.title').draft,
      ).toEqual({
        visibility: 'view_only',
        isCore: false,
        isAiInput: false,
      });
      expect(
        fieldOf(res.body.data, 'innovation_use', 'general.title').draft,
      ).toEqual({
        visibility: 'assessed',
        isCore: true,
        isAiInput: false,
      });
      // the item of the first edit, not sent now, is as it was
      expect(
        fieldOf(res.body.data, 'policy_change', 'policy_change.policy_type')
          .draft,
      ).toEqual(ASSESSED);
      // the answer is the view as stored
      expect(res.body.data).toEqual(await wholeView(id));
      expect(w.fieldConfigWorld.versions).toHaveLength(0);
    });

    it('answers with every problem at once, each with its item path and a catalog code, and writes nothing', async () => {
      const id = await createCycle(2026);
      await patch(id, [item('policy_change', 'general.title')]);

      const res = await refused(
        id,
        () =>
          patch(id, [
            item('no_such_type', 'general.title'),
            item('knowledge_product', 'policy_change.policy_type'),
            item('policy_change', 'general.title', {
              visibility: 'hidden',
              isCore: true,
            }),
            item('policy_change', 'policy_change.policy_type'),
            item('policy_change', 'policy_change.policy_type'),
          ]),
        400,
        'VALIDATION_FAILED',
      );

      expect(fieldsOf(res)).toEqual([
        ['items[0].resultTypeKey', 'INVALID'],
        ['items[1].fieldKey', 'INVALID'],
        ['items[2].isCore', 'NOT_ASSESSED'],
        ['items[4].fieldKey', 'INVALID'],
      ]);
    });

    it('FR-4: a flag true on an item that is not assessed is 400 naming that item', async () => {
      const id = await createCycle(2026);

      const res = await refused(
        id,
        () =>
          patch(id, [
            item('policy_change', 'general.title', {
              visibility: 'view_only',
              isCore: true,
              isAiInput: true,
            }),
          ]),
        400,
        'VALIDATION_FAILED',
      );

      expect(fieldsOf(res)).toEqual([
        ['items[0].isCore', 'NOT_ASSESSED'],
        ['items[0].isAiInput', 'NOT_ASSESSED'],
      ]);
    });

    it('FR-4: setting an assessed core field to hidden without the flags stores both false; assessed without flags stores both false (S-14)', async () => {
      const id = await createCycle(2026);
      await patch(id, [item('policy_change', 'general.title')]);

      const off = await patch(id, [
        {
          resultTypeKey: 'policy_change',
          fieldKey: 'general.title',
          visibility: 'hidden',
        },
        {
          resultTypeKey: 'innovation_use',
          fieldKey: 'general.title',
          visibility: 'assessed',
        },
      ]);

      expect(off.status).toBe(200);
      expect(
        fieldOf(off.body.data, 'policy_change', 'general.title').draft,
      ).toEqual(OFF);
      expect(
        fieldOf(off.body.data, 'innovation_use', 'general.title').draft,
      ).toEqual({
        visibility: 'assessed',
        isCore: false,
        isAiInput: false,
      });
      expect(
        w.fieldConfigWorld.draftItems.find(
          (row) =>
            row.resultTypeKey === 'policy_change' &&
            row.fieldKey === 'general.title',
        ),
      ).toMatchObject({
        visibility: 'hidden',
        isCore: false,
        isAiInput: false,
      });
    });

    it('the same values answer 200 with the view as stored: the revision does not move and nothing is written', async () => {
      const id = await createCycle(2026);
      const first = await patch(id, [item('policy_change', 'general.title')]);
      const writes = [...w.fieldConfigWorld.writeLog];

      const again = await patch(id, [item('policy_change', 'general.title')]);

      expect(again.status).toBe(200);
      expect(again.body.data.revision).toBe(first.body.data.revision);
      expect(again.body.data).toEqual(first.body.data);
      expect(w.fieldConfigWorld.writeLog).toEqual(writes);
    });

    it('two admins editing the same field one after the other: the later value is stored and the revision moves on each write (S-10)', async () => {
      const id = await createCycle(2026);

      const first = await patch(id, [item('policy_change', 'general.title')]);
      const second = await patch(
        id,
        [
          item('policy_change', 'general.title', {
            visibility: 'view_only',
          }),
        ],
        { token: bearer('sub-admin2') },
      );

      expect(second.status).toBe(200);
      expect(second.body.data.revision).toBe(first.body.data.revision + 1);
      expect(
        fieldOf(second.body.data, 'policy_change', 'general.title').draft,
      ).toEqual({
        visibility: 'view_only',
        isCore: false,
        isAiInput: false,
      });
      expect(w.fieldConfigWorld.drafts[0]).toMatchObject({
        updatedBy: w.admin2.id,
      });
    });

    it('NFR-2: an unknown field in the body or in an item is 400 UNKNOWN_FIELD and nothing is written', async () => {
      const id = await createCycle(2026);

      const top = await refused(
        id,
        () =>
          w.send('patch', `/cycles/${id}/field-config/draft`, {
            body: { items: [item('policy_change', 'general.title')], extra: 1 },
          }),
        400,
        'VALIDATION_FAILED',
      );
      const nested = await refused(
        id,
        () =>
          patch(id, [
            { ...item('policy_change', 'general.title'), color: 'red' },
          ]),
        400,
        'VALIDATION_FAILED',
      );

      expect(fieldsOf(top)).toEqual([['extra', 'UNKNOWN_FIELD']]);
      expect(fieldsOf(nested)).toEqual([['items[0].color', 'UNKNOWN_FIELD']]);
    });

    it('refuses an empty list and a null flag with 400, and a body that is not JSON with 400 MALFORMED_JSON', async () => {
      const id = await createCycle(2026);

      await refused(id, () => patch(id, []), 400, 'VALIDATION_FAILED');
      await refused(
        id,
        () =>
          patch(id, [
            { ...item('policy_change', 'general.title'), isCore: null },
          ]),
        400,
        'VALIDATION_FAILED',
      );
      await refused(
        id,
        () =>
          request(w.app.getHttpServer())
            .patch(`/api/v1/cycles/${id}/field-config/draft`)
            .set('Authorization', bearer('sub-admin'))
            .set('Content-Type', 'application/json')
            .send('{"items": ['),
        400,
        'MALFORMED_JSON',
      );
    });

    it('answers 404 for an unknown cycle', async () => {
      const id = await createCycle(2026);

      await refused(
        id,
        () => patch(99, [item('policy_change', 'general.title')]),
        404,
        'CYCLES_NOT_FOUND',
      );
    });

    it('a cycle whose year has no catalog is 409, and Reporting down is 503: nothing is written', async () => {
      await createCycle(2026);
      const id = await createCycle(2027);
      const body = [item('policy_change', 'general.title')];

      await refused(
        id,
        () => patch(id, body),
        409,
        'FIELD_CONFIG_CATALOG_MISSING',
        catalogMissing(2027),
      );
      await refused(
        id,
        () => patch(id, body),
        503,
        'SERVICE_UNAVAILABLE',
        catalogDown,
      );
    });

    it('FR-13: a closed cycle refuses the edit with 409 CYCLES_CLOSED', async () => {
      const id = await closedCycle();

      await refused(
        id,
        () => patch(id, [item('policy_change', 'general.title', OFF)]),
        409,
        'CYCLES_CLOSED',
      );
    });
  });

  // --- FR-6: discard ----------------------------------------------------------

  describe('FR-6: DELETE the draft', () => {
    it('resets the draft to the latest version and moves the revision', async () => {
      const id = await createCycle(2026);
      await edit(id, [item('policy_change', 'general.title')]);
      await patch(id, [
        item('policy_change', 'general.title', OFF),
        item('knowledge_product', 'general.title'),
      ]);
      const before = await revisionOf(id);

      const res = await discard(id);

      expect(res.status).toBe(200);
      expect(res.body.data.revision).toBe(before + 1);
      expect(
        fieldOf(res.body.data, 'policy_change', 'general.title'),
      ).toMatchObject({
        draft: ASSESSED,
        published: ASSESSED,
      });
      expect(
        fieldOf(res.body.data, 'knowledge_product', 'general.title'),
      ).toMatchObject({
        draft: OFF,
        published: OFF,
      });
      expect(res.body.data).toEqual(await wholeView(id));
    });

    it('with no version yet the draft becomes empty: no stored items, a field reads unclassified', async () => {
      const id = await createCycle(2026);
      await patch(id, [item('policy_change', 'general.title')]);

      const res = await discard(id);

      expect(res.status).toBe(200);
      expect(
        fieldOf(res.body.data, 'policy_change', 'general.title'),
      ).toMatchObject({
        unclassified: true,
        draft: OFF,
      });
      expect(w.fieldConfigWorld.draftItems).toEqual([]);
    });

    it('refuses an unknown cycle with 404, a closed one with 409 CYCLES_CLOSED, a missing catalog with 409 and Reporting down with 503', async () => {
      const closed = await closedCycle();
      const missing = await createCycle(2028);

      await refused(closed, () => discard(99), 404, 'CYCLES_NOT_FOUND');
      await refused(closed, () => discard(closed), 409, 'CYCLES_CLOSED');
      await refused(
        missing,
        () => discard(missing),
        409,
        'FIELD_CONFIG_CATALOG_MISSING',
        catalogMissing(2028),
      );
      await refused(
        missing,
        () => discard(missing),
        503,
        'SERVICE_UNAVAILABLE',
        catalogDown,
      );
    });
  });

  // --- FR-7: the preview ------------------------------------------------------

  describe('FR-7: GET the publish preview', () => {
    it('lists the changes against version 2, the timelines that receive and those that keep, and writes nothing', async () => {
      const id = await createCycle(2026);
      // versions 1 and 2 are published a month before today
      w.adminClock.advance(-days(30));
      await edit(id, [item('policy_change', 'general.title')]);
      await edit(id, [item('policy_change', 'policy_change.policy_type')]);
      w.adminClock.advance(days(30));
      // A started on 2026-10-05, B opens 2026-11-02 and C opens 2026-11-02 for a type nobody changes
      seedTimeline(1, id, '2026-10-05', ['policy_change']);
      seedTimeline(2, id, '2026-11-02', ['policy_change']);
      seedTimeline(3, id, '2026-11-02', ['knowledge_product']);
      const edited = await patch(id, [
        item('policy_change', 'general.title', { visibility: 'view_only' }),
      ]);
      const writes = [...w.fieldConfigWorld.writeLog];
      const rows = stored();
      const readsBefore = w.fieldCatalogs.requested.length;

      const res = await preview(id);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        revision: edited.body.data.revision,
        basedOn: 2,
        changes: [
          {
            resultTypeKey: 'policy_change',
            fieldKey: 'general.title',
            before: ASSESSED,
            after: { visibility: 'view_only', isCore: false, isAiInput: false },
          },
        ],
        timelines: {
          receive: [{ id: 2, name: 'Timeline 2', opensOn: '2026-11-02' }],
          keep: [
            { id: 1, name: 'Timeline 1', opensOn: '2026-10-05', version: 2 },
          ],
        },
      });
      // NFR-5: one catalog read for the request
      expect(w.fieldCatalogs.requested.length).toBe(readsBefore + 1);
      expect(w.fieldConfigWorld.writeLog).toEqual(writes);
      expect(stored()).toBe(rows);
    });

    it('FR-7 nothing to publish: with the draft equal to the latest version it reports no changes, based on that version, and writes nothing', async () => {
      const id = await createCycle(2026);
      seedTimeline(1, id, '2026-11-02', ['policy_change']);
      await edit(id, [item('policy_change', 'general.title')]);
      const current = await revisionOf(id);
      const writes = [...w.fieldConfigWorld.writeLog];
      const rows = stored();

      const res = await preview(id);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        revision: current,
        basedOn: 1,
        changes: [],
        timelines: { receive: [], keep: [] },
      });
      expect(w.fieldConfigWorld.writeLog).toEqual(writes);
      expect(stored()).toBe(rows);
    });

    it('a cycle never edited has no changes and no version to be based on', async () => {
      const id = await createCycle(2030);

      const res = await preview(id);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        revision: 0,
        basedOn: null,
        changes: [],
        timelines: { receive: [], keep: [] },
      });
    });

    it('works in a closed cycle: it lists the one change its draft holds against version 1', async () => {
      const id = await closedCycle();
      const rows = stored();

      const res = await preview(id);

      expect(res.status).toBe(200);
      expect(res.body.data.basedOn).toBe(1);
      expect(res.body.data.changes).toEqual([
        {
          resultTypeKey: 'policy_change',
          fieldKey: 'policy_change.policy_type',
          before: OFF,
          after: ASSESSED,
        },
      ]);
      expect(stored()).toBe(rows);
    });

    it('refuses an unknown cycle with 404, a missing catalog with 409 and Reporting down with 503', async () => {
      await createCycle(2026);
      const missing = await createCycle(2027);

      await refused(1, () => preview(99), 404, 'CYCLES_NOT_FOUND');
      await refused(
        missing,
        () => preview(missing),
        409,
        'FIELD_CONFIG_CATALOG_MISSING',
        catalogMissing(2027),
      );
      await refused(
        1,
        () => preview(1),
        503,
        'SERVICE_UNAVAILABLE',
        catalogDown,
      );
    });
  });

  // --- FR-8, FR-11, FR-12, NFR-3, NFR-8: publish ------------------------------

  describe('FR-8: POST publish', () => {
    it('creates version 1 and a GET then shows it; the version holds every applicable field, unclassified as hidden', async () => {
      const id = await createCycle(2026);
      const edited = await patch(id, [
        item('policy_change', 'general.title'),
        item('knowledge_product', 'general.title', { visibility: 'view_only' }),
      ]);

      const res = await publish(id, edited.body.data.revision);

      expect(res.status).toBe(201);
      expect(res.headers['idempotency-replayed']).toBeUndefined();
      expect(res.body).toMatchObject({ success: true });
      expect(res.body.data).toEqual({
        version: {
          number: 1,
          publishedAt: '2026-10-20T10:00:00.000Z',
          catalogVersion: '2026.30',
        },
        timelines: { receive: [], keep: [] },
      });
      const after = (await view(id)).body.data;
      expect(after.latestVersion).toEqual({
        number: 1,
        publishedAt: '2026-10-20T10:00:00.000Z',
      });
      expect(fieldOf(after, 'policy_change', 'general.title')).toMatchObject({
        published: ASSESSED,
        draft: ASSESSED,
      });
      expect(
        fieldOf(after, 'policy_change', 'policy_change.policy_type').published,
      ).toEqual(OFF);
      const applicable = after.resultTypes.reduce(
        (sum: number, t: { sections: Array<{ fields: unknown[] }> }) =>
          sum + t.sections.reduce((n, s) => n + s.fields.length, 0),
        0,
      );
      expect(w.fieldConfigWorld.versionItems).toHaveLength(applicable);
      expect(w.fieldConfigWorld.versions).toEqual([
        expect.objectContaining({
          cycleId: id,
          number: 1,
          catalogVersion: '2026.30',
          publishedBy: w.admin.id,
        }),
      ]);
    });

    it('NFR-8 and FR-11: one audit row with the changed items only, before and after, and the timelines that receive and keep', async () => {
      const id = await createCycle(2026);
      seedTimeline(1, id, '2026-11-02', ['policy_change']);
      const edited = await patch(id, [
        item('policy_change', 'general.title'),
        item('policy_change', 'policy_change.policy_type', OFF),
      ]);

      const res = await publish(id, edited.body.data.revision);

      expect(res.status).toBe(201);
      expect(res.body.data.timelines).toEqual({
        receive: [{ id: 1, name: 'Timeline 1', opensOn: '2026-11-02' }],
        keep: [],
      });
      expect(w.fieldConfigWorld.auditEvents).toHaveLength(1);
      expect(w.fieldConfigWorld.auditEvents[0]).toMatchObject({
        cycleId: id,
        actorId: w.admin.id,
        action: 'publish',
        requestId: res.headers['x-request-id'],
        changes: {
          'policy_change.general.title': { before: null, after: ASSESSED },
        },
        timelines: { receive: [1], keep: [] },
      });
      expect(
        Object.keys(w.fieldConfigWorld.auditEvents[0].changes as object),
      ).toEqual(['policy_change.general.title']);
    });

    it('FR-12: version 1 is unchanged by a later edit, discard and publication', async () => {
      const id = await createCycle(2026);
      await edit(id, [item('policy_change', 'general.title')]);
      const version = JSON.stringify([
        w.fieldConfigWorld.versions[0],
        w.fieldConfigWorld.versionItems.filter((v) => v.versionId === 1),
      ]);

      await patch(id, [item('policy_change', 'general.title', OFF)]);
      await discard(id);
      await edit(id, [item('knowledge_product', 'general.title')]);

      expect(
        JSON.stringify([
          w.fieldConfigWorld.versions[0],
          w.fieldConfigWorld.versionItems.filter((v) => v.versionId === 1),
        ]),
      ).toBe(version);
      expect(w.fieldConfigWorld.versions.map((v) => v.number)).toEqual([1, 2]);
    });

    it('a stale revision is 409 FIELD_CONFIG_REVISION_STALE and nothing is written', async () => {
      const id = await createCycle(2026);
      const edited = await patch(id, [item('policy_change', 'general.title')]);
      await patch(id, [item('knowledge_product', 'general.title')]);

      await refused(
        id,
        () => publish(id, edited.body.data.revision),
        409,
        'FIELD_CONFIG_REVISION_STALE',
      );
      expect(w.fieldConfigWorld.versions).toHaveLength(0);
      expect(w.fieldConfigWorld.auditEvents).toHaveLength(0);
    });

    it('a draft equal to the latest version is 409 FIELD_CONFIG_NOTHING_TO_PUBLISH, also for a cycle never edited', async () => {
      const id = await createCycle(2026);
      await refused(
        id,
        () => publish(id, 0),
        409,
        'FIELD_CONFIG_NOTHING_TO_PUBLISH',
      );
      await edit(id, [item('policy_change', 'general.title')]);
      const revision = await revisionOf(id);

      await refused(
        id,
        () => publish(id, revision),
        409,
        'FIELD_CONFIG_NOTHING_TO_PUBLISH',
      );
      expect(w.fieldConfigWorld.versions).toHaveLength(1);
      expect(w.fieldConfigWorld.auditEvents).toHaveLength(1);
    });

    it('NFR-3: two admins publishing with the same revision at once: one 201, one 409, one version, one audit row', async () => {
      const id = await createCycle(2026);
      const edited = await patch(id, [item('policy_change', 'general.title')]);
      const revision = edited.body.data.revision;

      const viewBeforeRace = (await wholeView(id)) as {
        resultTypes: Array<{ sections: Array<{ fields: FieldNode[] }> }>;
      };
      const [a, b] = await Promise.all([
        publish(id, revision, { key: 'race-a' }),
        publish(id, revision, { key: 'race-b', token: bearer('sub-admin2') }),
      ]);

      const statuses = [a.status, b.status].sort((x, y) => x - y);
      expect(statuses).toEqual([201, 409]);
      const loser = a.status === 409 ? a : b;
      expectError(loser, 409, 'FIELD_CONFIG_REVISION_STALE');
      // the loser changed nothing: the whole view is the winner's alone, i.e.
      // the view before the race with every field published as its draft
      const settled = await wholeView(id);
      const winnersView = structuredClone(
        viewBeforeRace,
      ) as typeof viewBeforeRace;
      for (const type of winnersView.resultTypes) {
        for (const section of type.sections) {
          for (const field of section.fields) field.published = field.draft;
        }
      }
      expect(settled).toEqual({
        ...winnersView,
        revision: revision + 1,
        latestVersion: { number: 1, publishedAt: '2026-10-20T10:00:00.000Z' },
      });
      expect(
        w.fieldConfigWorld.writeLog.filter((l) =>
          l.startsWith('version:insert'),
        ),
      ).toHaveLength(1);
      expect(
        w.fieldConfigWorld.writeLog.filter((l) => l.startsWith('draft:bump')),
      ).toHaveLength(2);
      // and the loser's request, sent again, is refused again with nothing stored
      await refused(
        id,
        () => publish(id, revision),
        409,
        'FIELD_CONFIG_REVISION_STALE',
      );
      expect(w.fieldConfigWorld.versions).toHaveLength(1);
      expect(w.fieldConfigWorld.versions[0].number).toBe(1);
      expect(w.fieldConfigWorld.auditEvents).toHaveLength(1);
      expect(
        w.fieldConfigWorld.versionItems.every((v) => v.versionId === 1),
      ).toBe(true);
      const after = (await view(id)).body.data;
      expect(after.latestVersion).toMatchObject({ number: 1 });
    });

    it('FR-8 replay: the same key returns the first answer, 201 marked as a replay, with one version and one audit row', async () => {
      const id = await createCycle(2026);
      seedTimeline(1, id, '2026-11-02', 'all');
      const edited = await patch(id, [item('policy_change', 'general.title')]);

      const first = await publish(id, edited.body.data.revision, {
        key: 'publish-1',
      });
      const replay = await publish(id, edited.body.data.revision, {
        key: 'publish-1',
      });

      expect(first.status).toBe(201);
      expect(first.headers['idempotency-replayed']).toBeUndefined();
      expect(replay.status).toBe(201);
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(replay.body.data).toEqual(first.body.data);
      expect(w.fieldConfigWorld.versions).toHaveLength(1);
      expect(w.fieldConfigWorld.auditEvents).toHaveLength(1);
    });

    it('the replay is the first answer even after the cycle moved on to version 2', async () => {
      const id = await createCycle(2026);
      const first = await edit(id, [item('policy_change', 'general.title')]);
      await edit(id, [item('knowledge_product', 'general.title')]);
      // the key of the first publication is not known to `edit`; publish again with a key
      const id2 = await createCycle(2027);
      const edited = await patch(id2, [item('policy_change', 'general.title')]);
      const keyed = await publish(id2, edited.body.data.revision, {
        key: 'moved-on',
      });
      await edit(id2, [item('knowledge_product', 'general.title')]);

      const replay = await publish(id2, edited.body.data.revision, {
        key: 'moved-on',
      });

      expect(first.body.data.version.number).toBe(1);
      expect(replay.status).toBe(201);
      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(replay.body.data).toEqual(keyed.body.data);
      expect(
        w.fieldConfigWorld.versions.filter((v) => v.cycleId === id2),
      ).toHaveLength(2);
      expect(
        w.fieldConfigWorld.auditEvents.filter((e) => e.cycleId === id2),
      ).toHaveLength(2);
    });

    it('without a key the route is not idempotent: the repeat is the plain 409 stale', async () => {
      const id = await createCycle(2026);
      const edited = await patch(id, [item('policy_change', 'general.title')]);
      await publish(id, edited.body.data.revision);

      const repeat = await refused(
        id,
        () => publish(id, edited.body.data.revision),
        409,
        'FIELD_CONFIG_REVISION_STALE',
      );

      expect(repeat.headers['idempotency-replayed']).toBeUndefined();
    });

    it('refuses a body with a missing or invalid revision or an unknown field with 400 (NFR-2), and a body that is not JSON with 400 MALFORMED_JSON', async () => {
      const id = await createCycle(2026);
      await patch(id, [item('policy_change', 'general.title')]);

      await refused(
        id,
        () =>
          w.send('post', `/cycles/${id}/field-config/publish`, { body: {} }),
        400,
        'VALIDATION_FAILED',
      );
      await refused(id, () => publish(id, -1), 400, 'VALIDATION_FAILED');
      await refused(id, () => publish(id, '1'), 400, 'VALIDATION_FAILED');
      const unknown = await refused(
        id,
        () =>
          w.send('post', `/cycles/${id}/field-config/publish`, {
            body: { revision: 1, force: true },
          }),
        400,
        'VALIDATION_FAILED',
      );
      await refused(
        id,
        () =>
          request(w.app.getHttpServer())
            .post(`/api/v1/cycles/${id}/field-config/publish`)
            .set('Authorization', bearer('sub-admin'))
            .set('Content-Type', 'application/json')
            .send('{"revision": '),
        400,
        'MALFORMED_JSON',
      );

      expect(fieldsOf(unknown)).toEqual([['force', 'UNKNOWN_FIELD']]);
    });

    it('refuses an unknown cycle with 404, a missing catalog with 409 and Reporting down with 503', async () => {
      await createCycle(2026);
      const missing = await createCycle(2027);

      await refused(1, () => publish(99, 0), 404, 'CYCLES_NOT_FOUND');
      await refused(
        missing,
        () => publish(missing, 0),
        409,
        'FIELD_CONFIG_CATALOG_MISSING',
        catalogMissing(2027),
      );
      await refused(
        1,
        () => publish(1, 0),
        503,
        'SERVICE_UNAVAILABLE',
        catalogDown,
      );
    });

    it('FR-13: a closed cycle refuses the publication with 409 CYCLES_CLOSED, before the revision is judged', async () => {
      const id = await closedCycle();
      const revision = await revisionOf(id);

      await refused(id, () => publish(id, revision), 409, 'CYCLES_CLOSED');
      await refused(id, () => publish(id, revision + 5), 409, 'CYCLES_CLOSED');
      expect(w.fieldConfigWorld.versions).toHaveLength(1);
      expect(w.fieldConfigWorld.auditEvents).toHaveLength(1);
    });

    it('an active cycle takes writes like a draft one', async () => {
      const id = await createCycle(2026);
      await activateCycle(id);

      const done = await edit(id, [item('policy_change', 'general.title')]);

      expect(done.body.data.version.number).toBe(1);
    });
  });

  // --- NFR-5: one catalog read per request -----------------------------------

  describe('NFR-5: at most one Reporting catalog read per request', () => {
    it('view, edit, preview, publish and discard each read the catalog of the cycle year exactly once; a refused one reads it at most once', async () => {
      const id = await createCycle(2026);
      const readsOf = async (call: () => Promise<request.Response>) => {
        const before = w.fieldCatalogs.requested.length;
        const res = await call();
        return {
          status: res.status,
          reads: w.fieldCatalogs.requested.length - before,
        };
      };

      const viewed = await readsOf(() => view(id));
      const edited = await readsOf(() =>
        patch(id, [item('policy_change', 'general.title')]),
      );
      const refusedEdit = await readsOf(() =>
        patch(id, [
          item('policy_change', 'general.title', {
            visibility: 'hidden',
            isCore: true,
          }),
        ]),
      );
      const previewed = await readsOf(() => preview(id));
      const stale = await readsOf(() => publish(id, 99));
      const current = await revisionOf(id);
      const published = await readsOf(() => publish(id, current));
      const after = await revisionOf(id);
      const nothing = await readsOf(() => publish(id, after));
      const discarded = await readsOf(() => discard(id));

      expect([viewed, edited, previewed, published, discarded]).toEqual([
        { status: 200, reads: 1 },
        { status: 200, reads: 1 },
        { status: 200, reads: 1 },
        { status: 201, reads: 1 },
        { status: 200, reads: 1 },
      ]);
      expect(refusedEdit.status).toBe(400);
      expect(stale.status).toBe(409);
      expect(nothing.status).toBe(409);
      for (const refusal of [refusedEdit, stale, nothing]) {
        expect(refusal.reads).toBeLessThanOrEqual(1);
      }
      expect(new Set(w.fieldCatalogs.requested)).toEqual(new Set([2026]));
    });
  });

  // --- NFR-7: the log lines ---------------------------------------------------

  describe('NFR-7: one decision line per write', () => {
    const lineOf = (res: request.Response, action: string) =>
      spy
        .eventsOf('admin_config', res.headers['x-request-id'] as string)
        .filter((line) => line.action === action);

    it('logs ok and refused lines with ids, outcome and reason only: never an item or a field key', async () => {
      const id = await createCycle(2026);
      const ok = await patch(id, [item('policy_change', 'general.title')]);
      const bad = await refused(
        id,
        () =>
          patch(id, [
            item('policy_change', 'general.title', {
              visibility: 'hidden',
              isCore: true,
            }),
          ]),
        400,
        'VALIDATION_FAILED',
      );
      const discarded = await discard(id);
      const stale = await refused(
        id,
        () => publish(id, 99),
        409,
        'FIELD_CONFIG_REVISION_STALE',
      );
      const current = await revisionOf(id);
      const nothing = await refused(
        id,
        () => publish(id, current),
        409,
        'FIELD_CONFIG_NOTHING_TO_PUBLISH',
      );

      const base = {
        event: 'admin_config',
        targetId: id,
        actorId: w.admin.id,
        idempotency: 'none',
      };
      expect(lineOf(ok, 'field_config_update')).toEqual([
        {
          ...base,
          action: 'field_config_update',
          outcome: 'ok',
          requestId: ok.headers['x-request-id'],
        },
      ]);
      expect(lineOf(bad, 'field_config_update')).toEqual([
        {
          ...base,
          action: 'field_config_update',
          outcome: 'refused',
          reason: 'VALIDATION_FAILED',
          requestId: bad.headers['x-request-id'],
        },
      ]);
      expect(lineOf(discarded, 'field_config_discard')).toEqual([
        {
          ...base,
          action: 'field_config_discard',
          outcome: 'ok',
          requestId: discarded.headers['x-request-id'],
        },
      ]);
      expect(lineOf(stale, 'field_config_publish')).toMatchObject([
        { outcome: 'refused', reason: 'FIELD_CONFIG_REVISION_STALE' },
      ]);
      expect(lineOf(nothing, 'field_config_publish')).toMatchObject([
        { outcome: 'refused', reason: 'FIELD_CONFIG_NOTHING_TO_PUBLISH' },
      ]);
      const text = spy.lines.join('\n');
      expect(text).not.toContain('general.title');
      expect(text).not.toContain('policy_change.policy_type');
      expect(text).not.toContain('NOT_ASSESSED');
    });

    it('a successful publication logs one ok line', async () => {
      const id = await createCycle(2026);
      const edited = await patch(id, [item('policy_change', 'general.title')]);

      const done = await publish(id, edited.body.data.revision);

      expect(lineOf(done, 'field_config_publish')).toMatchObject([
        { outcome: 'ok', targetId: id, actorId: w.admin.id },
      ]);
    });

    it('a closed cycle logs a refused line with its code', async () => {
      const closed = await closedCycle();
      const refusedClosed = await refused(
        closed,
        () => patch(closed, [item('policy_change', 'general.title', OFF)]),
        409,
        'CYCLES_CLOSED',
      );
      expect(lineOf(refusedClosed, 'field_config_update')).toMatchObject([
        { outcome: 'refused', reason: 'CYCLES_CLOSED', targetId: closed },
      ]);
    });
  });
});
