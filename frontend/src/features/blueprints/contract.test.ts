import { describe, expect, it } from 'vitest'
import maximalGuardianBlueprint from './fixtures/guardian_blueprint_maximal.json'
import type { BlueprintDraft } from './contract'
import { changeBlueprintSource, createBlueprintDraft, getBlueprintCollision, normalizeBlueprintDraft, validateBlueprintDraft } from './contract'

describe('Blueprint builder contract', () => {
  it('uses the safe backend defaults for a new Steam blueprint', () => {
    const draft = createBlueprintDraft()
    expect(draft.version).toBe(1)
    expect(draft.source.updateStrategy).toBe('checkBased')
    expect(draft.runtime.enableExec).toBe(false)
  })

  it('replaces source-dependent objects instead of serializing extras', () => {
    const changed = changeBlueprintSource(createBlueprintDraft(), 'github')
    expect(changed.source).toEqual({ type: 'github', updateStrategy: 'checkBased', github: { repo: '', branch: 'main', setupCommands: [] } })
  })

  it('blocks unsafe identifiers, shell chaining, duplicate ports and insecure URLs', () => {
    const draft = changeBlueprintSource(createBlueprintDraft(), 'http')
    draft.meta.id = 'Unsafe-ID'
    draft.runtime.startup = './server && $(rm)'
    draft.ports.push({ name: 'game', protocol: 'udp' })
    draft.source.http!.url = 'http://example.invalid/server.zip'
    expect(validateBlueprintDraft(draft).map(issue => issue.path)).toEqual(expect.arrayContaining(['meta.id', 'runtime.startup', 'ports.1', 'source.http.url']))
  })

  it('normalizes display-style blueprint ids without changing the visible name', () => {
    const draft = createBlueprintDraft()
    draft.meta.id = 'ARK Survival Ascended ASA MauntARK'
    draft.meta.name = 'ARK Survival Ascended ASA MauntARK'

    const normalized = normalizeBlueprintDraft(draft)

    expect(normalized.meta.id).toBe('ark_survival_ascended_asa_mauntark')
    expect(normalized.meta.name).toBe('ARK Survival Ascended ASA MauntARK')
    expect(validateBlueprintDraft(normalized)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'meta.id' })]),
    )
  })

  it('omits optional empty blocks without changing the schema version', () => {
    const normalized = normalizeBlueprintDraft(createBlueprintDraft())
    expect(normalized.version).toBe(1)
    expect(normalized).not.toHaveProperty('mods')
    expect(normalized).not.toHaveProperty('backup')
  })

  it('never silently replaces native or community entries in create mode', () => {
    const entries = [{ id: 'native_bp', origin: 'native' as const }, { id: 'community_bp', origin: 'community' as const }]
    expect(getBlueprintCollision(entries, 'native_bp', false)).toBe('native-blocked')
    expect(getBlueprintCollision(entries, 'community_bp', false)).toBe('community-confirm')
    expect(getBlueprintCollision(entries, 'community_bp', true)).toBe('none')
  })

  it('round-trips every Guardian field without deleting or rewriting JSON-only settings', () => {
    const draft = structuredClone(maximalGuardianBlueprint) as BlueprintDraft
    expect(validateBlueprintDraft(draft)).toEqual([])
    expect(normalizeBlueprintDraft(draft)).toEqual(maximalGuardianBlueprint)
  })

  it('keeps startup timing when no log pattern is configured', () => {
    const draft = createBlueprintDraft()
    draft.health!.startup = {
      grace_period_seconds: 75,
      timeout_seconds: 600,
      success_patterns: [],
      failure_patterns: [],
    }
    expect(normalizeBlueprintDraft(draft).health?.startup).toEqual(draft.health!.startup)
  })

  it('rejects Guardian values that the runtime cannot execute', () => {
    const draft = createBlueprintDraft()
    ;(draft.health!.application as { type: string }).type = 'custom-probe'
    draft.diagnostics!.parsers = ['custom-parser' as never]
    draft.recovery!.policies = [{ match: 'custom-signal', action: 'custom-action' as never }]
    draft.logs!.redact = ['password']

    expect(validateBlueprintDraft(draft).map(issue => issue.key)).toEqual(expect.arrayContaining([
      'blueprintBuilder.validation.healthAppTypeUnsupported',
      'blueprintBuilder.validation.diagnosticsParser',
      'blueprintBuilder.validation.recoveryMatchUnsupported',
      'blueprintBuilder.validation.recoveryActionUnsupported',
      'blueprintBuilder.validation.logsRedactor',
    ]))
  })

  it('mirrors backend limits for regexes, log paths, protected paths, startup and recovery budgets', () => {
    const draft = createBlueprintDraft()
    draft.health!.startup = {
      grace_period_seconds: 601,
      timeout_seconds: 600,
      success_patterns: ['(a+)+'],
      failure_patterns: Array.from({ length: 17 }, (_, index) => `failure-${index}`),
    }
    draft.logs!.sources = ['../secret.log', 'logs/**/latest.log']
    draft.logs!.redact = ['regex:(token+)+']
    draft.backups!.protected_paths = ['world/*']
    draft.recovery!.max_attempts = 11
    draft.recovery!.verification = { ...draft.recovery!.verification, verification_timeout_seconds: 4 }

    expect(validateBlueprintDraft(draft).map(issue => issue.key)).toEqual(expect.arrayContaining([
      'blueprintBuilder.validation.healthStartupTimeout',
      'blueprintBuilder.validation.guardianArrayLimit',
      'blueprintBuilder.validation.guardianRegex',
      'blueprintBuilder.validation.logsSource',
      'blueprintBuilder.validation.logsRedactor',
      'blueprintBuilder.validation.unsafePath',
      'blueprintBuilder.validation.recoveryBounds',
    ]))
  })

  it('validates forbidden env keys, iniKey mod lists, modIdResolvers, modListTargets, and purgeBefore', () => {
    const draft = createBlueprintDraft()
    draft.meta.id = 'zomboid_test'
    draft.meta.name = 'Zomboid Test'
    draft.meta.category = 'web_app'
    draft.ports.push({ name: 'peer', protocol: 'tcp' }, { name: 'database', protocol: 'tcp' })
    draft.runtime.startup = './start'
    draft.runtime.env = { DOCKER_HOST: 'unix:///evil.sock' }
    draft.source.steam!.appId = '380870'
    draft.mods = {
      supportsMods: true,
      supportsSteamWorkshop: true,
      workshopAppId: '108600',
      filterTags: [],
      modInjection: 'file',
      modListFilePath: 'Server/test.ini',
      modListContent: 'iniKey',
      modIdResolvers: [
        { name: 'zomboid_mod', fileGlob: 'steamapps/workshop/content/{WORKSHOP_APP_ID}/{WORKSHOP_ID}/**/mod.info', format: 'iniKey', key: 'id', maxMatches: 32, fallback: 'skip' },
      ],
      modListTargets: [
        { file: 'Server/{SERVER_NAME}.ini', key: 'Mods', valueSource: 'resolvedIds:missing_resolver', separator: ';' },
      ],
      postInstall: [
        { operation: 'copy', source: 'workshop/{WORKSHOP_ID}/*.pak', target: 'Mods/{BASENAME}', purgeBefore: ['/abs/bad'], required: true },
      ],
    }

    expect(validateBlueprintDraft(draft).map(issue => issue.key)).toEqual(expect.arrayContaining([
      'blueprintBuilder.validation.envForbidden',
      'blueprintBuilder.validation.targetSource',
      'blueprintBuilder.validation.purgeBefore',
    ]))

    draft.runtime.env = { NODE_ENV: 'production' }
    draft.mods.modListTargets![0].valueSource = 'resolvedIds:zomboid_mod'
    draft.mods.postInstall[0].purgeBefore = ['Saved/ExtractedMods/{STEM}.pak']
    expect(validateBlueprintDraft(draft)).toEqual([])
  })

  it('round-trips the optional steam artworkAppId', () => {
    const draft = createBlueprintDraft()
    draft.source.steam!.appId = '380870'
    draft.source.steam!.artworkAppId = '108600'
    const paths = validateBlueprintDraft(draft).map(issue => issue.path)
    expect(paths).not.toContain('source.steam.appId')
    expect(paths).not.toContain('source.steam.artworkAppId')
    expect(normalizeBlueprintDraft(draft).source.steam!.artworkAppId).toBe('108600')
  })

  it('rejects a non-numeric steam artworkAppId but allows empty', () => {
    const draft = createBlueprintDraft()
    draft.source.steam!.appId = '380870'
    draft.source.steam!.artworkAppId = 'game-1'
    expect(validateBlueprintDraft(draft).map(issue => issue.path)).toContain('source.steam.artworkAppId')
    draft.source.steam!.artworkAppId = '   '
    const normalized = normalizeBlueprintDraft(draft)
    expect(normalized.source.steam).not.toHaveProperty('artworkAppId')
  })
})
