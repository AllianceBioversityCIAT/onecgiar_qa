import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { WorkspaceLayout } from './workspace-layout';

@Component({ template: '' })
class Blank {}

describe('WorkspaceLayout', () => {
  const setup = () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'results', component: Blank },
          { path: 'results/:code', component: Blank },
          { path: 'cycle', component: Blank },
        ]),
      ],
    });
    return { layout: TestBed.inject(WorkspaceLayout), router: TestBed.inject(Router) };
  };

  it('the sidebar starts collapsed on a review page and open elsewhere', async () => {
    const { layout, router } = setup();
    await router.navigateByUrl('/results');
    expect(layout.menuCollapsed()).toBe(false);
    await router.navigateByUrl('/results/9890');
    expect(layout.menuCollapsed()).toBe(true);
    await router.navigateByUrl('/cycle');
    expect(layout.menuCollapsed()).toBe(false);
  });

  it('setFocus(true) collapses the sidebar and the navigator together; false opens both', async () => {
    const { layout, router } = setup();
    await router.navigateByUrl('/results');
    layout.setFocus(true);
    expect(layout.menuCollapsed()).toBe(true);
    expect(layout.navigatorCollapsed()).toBe(true);
    expect(layout.focused()).toBe(true);
    layout.setFocus(false);
    expect(layout.menuCollapsed()).toBe(false);
    expect(layout.navigatorCollapsed()).toBe(false);
    expect(layout.focused()).toBe(false);
  });

  it('a query change on the same page (?as= role preview) keeps Focus on', async () => {
    const { layout, router } = setup();
    await router.navigateByUrl('/results/9890');
    layout.setFocus(true);
    await router.navigateByUrl('/results/9890?as=tpb');
    expect(layout.focused()).toBe(true);
  });

  it('a navigation resets both to the default of the new page', async () => {
    const { layout, router } = setup();
    await router.navigateByUrl('/results/9890');
    layout.setFocus(true);
    await router.navigateByUrl('/results');
    expect(layout.menuCollapsed()).toBe(false);
    expect(layout.navigatorCollapsed()).toBe(false);
  });
});
