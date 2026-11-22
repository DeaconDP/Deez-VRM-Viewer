import type { LicenceInfo, MetaGroup, MetaRow, MetaValue } from '../types';

/** Structural copies of three-vrm-core's VRM1Meta / VRM0Meta (minus thumbnail textures) so this module stays DOM-free. */
export interface VRM1MetaLike {
  metaVersion: '1';
  name?: string; version?: string; authors?: string[]; copyrightInformation?: string; contactInformation?: string;
  references?: string[]; thirdPartyLicenses?: string; licenseUrl?: string;
  avatarPermission?: 'onlyAuthor' | 'onlySeparatelyLicensedPerson' | 'everyone';
  allowExcessivelyViolentUsage?: boolean; allowExcessivelySexualUsage?: boolean;
  commercialUsage?: 'personalNonProfit' | 'personalProfit' | 'corporation';
  allowPoliticalOrReligiousUsage?: boolean; allowAntisocialOrHateUsage?: boolean;
  creditNotation?: 'required' | 'unnecessary'; allowRedistribution?: boolean;
  modification?: 'prohibited' | 'allowModification' | 'allowModificationRedistribution';
  otherLicenseUrl?: string;
}

export interface VRM0MetaLike {
  metaVersion: '0';
  title?: string; version?: string; author?: string; contactInformation?: string; reference?: string;
  allowedUserName?: 'Everyone' | 'ExplicitlyLicensedPerson' | 'OnlyAuthor';
  violentUssageName?: 'Allow' | 'Disallow'; sexualUssageName?: 'Allow' | 'Disallow'; commercialUssageName?: 'Allow' | 'Disallow';
  otherPermissionUrl?: string;
  licenseName?: 'CC0' | 'CC_BY' | 'CC_BY_NC' | 'CC_BY_NC_ND' | 'CC_BY_NC_SA' | 'CC_BY_ND' | 'CC_BY_SA' | 'Other' | 'Redistribution_Prohibited';
  otherLicenseUrl?: string;
}

export const NOT_SPECIFIED = 'Not specified';

const PERMISSION_ROWS = ['avatar', 'violent', 'sexual', 'commercial', 'political', 'antisocial', 'credit', 'redistribution', 'modification'];

const AVATAR_1: Record<string, string> = { onlyAuthor: 'Only the author', onlySeparatelyLicensedPerson: 'Only separately licensed people', everyone: 'Everyone' };
const COMMERCIAL_1: Record<string, string> = { personalNonProfit: 'Personal, non-profit', personalProfit: 'Personal, for profit', corporation: 'Corporations and personal' };
const CREDIT_1: Record<string, string> = { required: 'Required', unnecessary: 'Not required' };
const MODIFICATION_1: Record<string, string> = { prohibited: 'Not allowed', allowModification: 'Allowed (no redistribution of changes)', allowModificationRedistribution: 'Allowed, including redistribution' };
const AVATAR_0: Record<string, string> = { OnlyAuthor: 'Only the author', ExplicitlyLicensedPerson: 'Only explicitly licensed people', Everyone: 'Everyone' };
const ALLOW_0: Record<string, string> = { Allow: 'Allowed', Disallow: 'Not allowed' };
const LICENSE_0: Record<string, string> = {
  CC0: 'CC0 (public domain)', CC_BY: 'CC BY', CC_BY_NC: 'CC BY-NC', CC_BY_NC_ND: 'CC BY-NC-ND', CC_BY_NC_SA: 'CC BY-NC-SA',
  CC_BY_ND: 'CC BY-ND', CC_BY_SA: 'CC BY-SA', Other: 'Other', Redistribution_Prohibited: 'Redistribution prohibited'
};

/** Returns the URL only when it parses as http(s); anything else (javascript:, data:, relative) is never linkable. */
export function safeHref(value: string): string | undefined {
  try { const url = new URL(value.trim()); return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined; }
  catch { return undefined; }
}

const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const textValue = (value: unknown): MetaValue[] => { const text = clean(value); return text ? [{ text }] : []; };
const linkValue = (value: unknown): MetaValue[] => { const text = clean(value); if (!text) return []; const href = safeHref(text); return [href ? { text, href } : { text }]; };
const listValues = (values: unknown, link = false): MetaValue[] => (Array.isArray(values) ? values : []).flatMap(v => link ? linkValue(v) : textValue(v));
const enumValue = (map: Record<string, string>, value: unknown): MetaValue[] => typeof value === 'string' && value ? [{ text: map[value] ?? value }] : [];
const boolValue = (value: unknown): MetaValue[] => typeof value === 'boolean' ? [{ text: value ? 'Allowed' : 'Not allowed' }] : [];

function rows(entries: [key: string, label: string, values: MetaValue[]][]): MetaRow[] {
  return entries.flatMap(([key, label, values]) => values.length ? [{ key, label, values }]
    : PERMISSION_ROWS.includes(key) ? [{ key, label, values: [{ text: NOT_SPECIFIED }] }] : []);
}

const group = (id: MetaGroup['id'], title: string, entries: Parameters<typeof rows>[0]): MetaGroup => ({ id, title, rows: rows(entries) });

/** Maps VRM 1.0 or 0.x meta to one grouped, human-readable shape. Returns null for missing or unknown meta. */
export function describeVrmMeta(meta: VRM1MetaLike | VRM0MetaLike | null | undefined): LicenceInfo | null {
  if (!meta) return null;
  if (meta.metaVersion === '1') return {
    metaVersion: '1', groups: [
      group('identity', 'Identity', [
        ['name', 'Name', textValue(meta.name)], ['version', 'Version', textValue(meta.version)], ['authors', 'Authors', listValues(meta.authors)],
        ['contact', 'Contact', linkValue(meta.contactInformation)], ['references', 'References', listValues(meta.references, true)],
        ['copyright', 'Copyright', textValue(meta.copyrightInformation)]
      ]),
      group('permissions', 'Permissions', [
        ['avatar', 'Avatar use', enumValue(AVATAR_1, meta.avatarPermission)], ['violent', 'Violent use', boolValue(meta.allowExcessivelyViolentUsage)],
        ['sexual', 'Sexual use', boolValue(meta.allowExcessivelySexualUsage)], ['commercial', 'Commercial use', enumValue(COMMERCIAL_1, meta.commercialUsage)],
        ['political', 'Political or religious use', boolValue(meta.allowPoliticalOrReligiousUsage)], ['antisocial', 'Antisocial or hate use', boolValue(meta.allowAntisocialOrHateUsage)]
      ]),
      group('redistribution', 'Redistribution', [
        ['credit', 'Credit', enumValue(CREDIT_1, meta.creditNotation)], ['redistribution', 'Redistribution', boolValue(meta.allowRedistribution)],
        ['modification', 'Modification', enumValue(MODIFICATION_1, meta.modification)], ['licenseUrl', 'Licence', linkValue(meta.licenseUrl)],
        ['otherLicenseUrl', 'Other licence', linkValue(meta.otherLicenseUrl)], ['thirdParty', 'Third-party licences', textValue(meta.thirdPartyLicenses)]
      ])
    ]
  };
  if (meta.metaVersion === '0') return {
    metaVersion: '0', groups: [
      group('identity', 'Identity', [
        ['name', 'Name', textValue(meta.title)], ['version', 'Version', textValue(meta.version)], ['authors', 'Authors', textValue(meta.author)],
        ['contact', 'Contact', linkValue(meta.contactInformation)], ['references', 'References', linkValue(meta.reference)]
      ]),
      group('permissions', 'Permissions', [
        ['avatar', 'Avatar use', enumValue(AVATAR_0, meta.allowedUserName)], ['violent', 'Violent use', enumValue(ALLOW_0, meta.violentUssageName)],
        ['sexual', 'Sexual use', enumValue(ALLOW_0, meta.sexualUssageName)], ['commercial', 'Commercial use', enumValue(ALLOW_0, meta.commercialUssageName)],
        ['otherPermissionUrl', 'Other permissions', linkValue(meta.otherPermissionUrl)]
      ]),
      group('redistribution', 'Redistribution', [
        ['licenseName', 'Licence', enumValue(LICENSE_0, meta.licenseName)], ['otherLicenseUrl', 'Other licence', linkValue(meta.otherLicenseUrl)]
      ])
    ]
  };
  return null;
}
