import { describe, expect, it } from 'vitest';
import type { LicenceInfo } from '../types';
import { NOT_SPECIFIED, describeVrmMeta, safeHref } from './vrmMeta';

const row = (info: LicenceInfo | null, key: string) => info?.groups.flatMap(g => g.rows).find(r => r.key === key);
const text = (info: LicenceInfo | null, key: string) => row(info, key)?.values.map(v => v.text).join(' | ');

describe('safeHref', () => {
  it('accepts only http(s) URLs', () => {
    expect(safeHref('https://vrm.dev/licenses/1.0/')).toBe('https://vrm.dev/licenses/1.0/');
    expect(safeHref(' http://example.com ')).toBe('http://example.com/');
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref('JavaScript:alert(1)')).toBeUndefined();
    expect(safeHref('data:text/html,hi')).toBeUndefined();
    expect(safeHref('mailto:a@b.c')).toBeUndefined();
    expect(safeHref('/relative')).toBeUndefined();
    expect(safeHref('someone@example.com')).toBeUndefined();
  });
});

describe('describeVrmMeta', () => {
  it('returns null for missing or unknown meta', () => {
    expect(describeVrmMeta(null)).toBeNull();
    expect(describeVrmMeta(undefined)).toBeNull();
    expect(describeVrmMeta({ metaVersion: '2' } as never)).toBeNull();
  });

  it('maps a full VRM 1.0 meta into three groups with plain words', () => {
    const info = describeVrmMeta({
      metaVersion: '1', name: 'Avatar', version: '1.2', authors: ['Ann', ' ', 'Bob'], copyrightInformation: '(c) Ann',
      contactInformation: 'https://ann.example', references: ['https://ref.example', 'Original sketch'], thirdPartyLicenses: 'Font: OFL',
      licenseUrl: 'https://vrm.dev/licenses/1.0/', avatarPermission: 'onlyAuthor', allowExcessivelyViolentUsage: false,
      allowExcessivelySexualUsage: true, commercialUsage: 'personalNonProfit', allowPoliticalOrReligiousUsage: false,
      allowAntisocialOrHateUsage: false, creditNotation: 'required', allowRedistribution: true, modification: 'allowModificationRedistribution',
      otherLicenseUrl: 'javascript:alert(1)'
    });
    expect(info?.metaVersion).toBe('1');
    expect(info?.groups.map(g => g.id)).toEqual(['identity', 'permissions', 'redistribution']);
    expect(info?.groups[0].rows.map(r => r.key)).toEqual(['name', 'version', 'authors', 'contact', 'references', 'copyright']);
    expect(row(info, 'authors')?.values).toEqual([{ text: 'Ann' }, { text: 'Bob' }]);
    expect(row(info, 'references')?.values).toEqual([{ text: 'https://ref.example', href: 'https://ref.example/' }, { text: 'Original sketch' }]);
    expect(text(info, 'avatar')).toBe('Only the author');
    expect(text(info, 'violent')).toBe('Not allowed');
    expect(text(info, 'sexual')).toBe('Allowed');
    expect(text(info, 'commercial')).toBe('Personal, non-profit');
    expect(text(info, 'credit')).toBe('Required');
    expect(text(info, 'redistribution')).toBe('Allowed');
    expect(text(info, 'modification')).toBe('Allowed, including redistribution');
    expect(text(info, 'thirdParty')).toBe('Font: OFL');
    expect(row(info, 'licenseUrl')?.values[0].href).toBe('https://vrm.dev/licenses/1.0/');
    expect(row(info, 'otherLicenseUrl')?.values).toEqual([{ text: 'javascript:alert(1)' }]);
  });

  it('omits missing identity rows but marks missing permissions as not specified', () => {
    const info = describeVrmMeta({ metaVersion: '1', name: 'Bare', authors: [], licenseUrl: '' });
    expect(info?.groups[0].rows.map(r => r.key)).toEqual(['name']);
    for (const key of ['avatar', 'violent', 'sexual', 'commercial', 'political', 'antisocial', 'credit', 'redistribution', 'modification']) expect(text(info, key)).toBe(NOT_SPECIFIED);
    expect(row(info, 'licenseUrl')).toBeUndefined();
    expect(row(info, 'thirdParty')).toBeUndefined();
  });

  it('maps VRM 0.x meta, including the misspelled Ussage fields', () => {
    const info = describeVrmMeta({
      metaVersion: '0', title: 'Old', version: '0.9', author: 'Cat', contactInformation: 'cat@example.com', reference: 'https://orig.example',
      allowedUserName: 'ExplicitlyLicensedPerson', violentUssageName: 'Disallow', sexualUssageName: 'Allow', commercialUssageName: 'Disallow',
      otherPermissionUrl: 'https://perm.example', licenseName: 'CC_BY_NC_SA', otherLicenseUrl: 'ftp://x.example/licence'
    });
    expect(info?.metaVersion).toBe('0');
    expect(text(info, 'name')).toBe('Old');
    expect(text(info, 'authors')).toBe('Cat');
    expect(row(info, 'contact')?.values).toEqual([{ text: 'cat@example.com' }]);
    expect(row(info, 'references')?.values[0].href).toBe('https://orig.example/');
    expect(text(info, 'avatar')).toBe('Only explicitly licensed people');
    expect(text(info, 'violent')).toBe('Not allowed');
    expect(text(info, 'sexual')).toBe('Allowed');
    expect(text(info, 'commercial')).toBe('Not allowed');
    expect(row(info, 'otherPermissionUrl')?.values[0].href).toBe('https://perm.example/');
    expect(text(info, 'licenseName')).toBe('CC BY-NC-SA');
    expect(row(info, 'otherLicenseUrl')?.values).toEqual([{ text: 'ftp://x.example/licence' }]);
    expect(row(info, 'political')).toBeUndefined();
  });

  it('keeps unknown enum values readable and fills missing VRM 0.x permissions', () => {
    const info = describeVrmMeta({ metaVersion: '0', licenseName: 'Custom' as never });
    expect(text(info, 'licenseName')).toBe('Custom');
    expect(text(info, 'avatar')).toBe(NOT_SPECIFIED);
    expect(text(info, 'commercial')).toBe(NOT_SPECIFIED);
    expect(info?.groups[0].rows).toEqual([]);
  });
});
