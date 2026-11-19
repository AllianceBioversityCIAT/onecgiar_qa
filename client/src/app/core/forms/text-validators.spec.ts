import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SchemaOrSchemaFn, form, required } from '@angular/forms/signals';
import { emailText, requiredText } from './text-validators';

function build<T>(value: T, schema: SchemaOrSchemaFn<T>) {
  const model = signal(value);
  const tree = form(model, schema, { injector: TestBed.inject(Injector) });
  return { model, tree };
}

describe('requiredText', () => {
  it('Angular required alone lets only spaces through (the bug this closes)', () => {
    const { tree } = build({ name: '   ' }, (f) => required(f.name, { message: 'Enter a name.' }));
    expect(tree.name().valid()).toBe(true);
  });

  it('only spaces is empty; real text passes; empty keeps the required error', () => {
    const { model, tree } = build({ name: '   ' }, (f) => requiredText(f.name, { message: 'Enter a name.' }));
    expect(tree.name().errors().map((e) => e.message)).toEqual(['Enter a name.']);
    model.set({ name: '  Round 2 ' });
    expect(tree.name().valid()).toBe(true);
    model.set({ name: '' });
    expect(tree.name().errors().map((e) => e.message)).toEqual(['Enter a name.']);
    expect(tree.name().required()).toBe(true);
  });

  it('when() off: no error, even with only spaces', () => {
    const { tree } = build({ name: '  ' }, (f) => requiredText(f.name, { message: 'Enter a name.', when: () => false }));
    expect(tree.name().valid()).toBe(true);
  });
});

describe('emailText', () => {
  it('accepts an address with spaces around it and rejects a wrong one', () => {
    const { model, tree } = build({ email: ' name@cgiar.org ' }, (f) => emailText(f.email, { message: 'Enter a valid email.' }));
    expect(tree.email().valid()).toBe(true);
    model.set({ email: 'name@' });
    expect(tree.email().errors().map((e) => e.message)).toEqual(['Enter a valid email.']);
    model.set({ email: '   ' });
    expect(tree.email().valid()).toBe(true); // empty is requiredText's job
  });
});
