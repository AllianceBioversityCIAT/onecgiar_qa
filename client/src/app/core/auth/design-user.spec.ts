import { designUserAllowed, isDesignUser } from './design-user';

describe('design user', () => {
  it('only works on the design preview (CloudFront) and local work', () => {
    expect(designUserAllowed('d1q06uhr5i46v9.cloudfront.net')).toBe(true);
    expect(designUserAllowed('localhost')).toBe(true);
    expect(designUserAllowed('qatest.ciat.cgiar.org')).toBe(false);
    expect(designUserAllowed('qa.cgiar.org')).toBe(false);
    expect(designUserAllowed('d9other.cloudfront.net')).toBe(false);
  });

  it('needs the exact credentials', () => {
    expect(isDesignUser({ email: ' Design@qa.cgiar ', password: 'design-preview' })).toBe(true);
    expect(isDesignUser({ email: 'design@qa.cgiar', password: 'x' })).toBe(false);
  });
});
