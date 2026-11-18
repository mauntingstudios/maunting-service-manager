import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'

import type { AiContextStatus, AiProviderAvailable } from '@/api/ai'
import { api } from '@/api/client'
import {
  aiModelChoiceKey,
  aiModelReasoningKey,
  readAiModelChoice,
  readAiModelReasoningChoice,
  readAiProviderChoice,
  readAiReasoningChoice,
  writeAiModelChoice,
  writeAiModelReasoningChoice,
  writeAiProviderChoice,
  writeAiReasoningChoice,
  type AiChatPreferenceKeys,
} from '@/lib/aiChatPreferences'
import { useAuthStore } from '@/stores/authStore'
import type { Denkwahl } from './AiModellBlatt'
import { denkwahlFuer } from './ReasoningPicker'
import type { chatScopeApi } from './chatScope'

export function providerBeimOeffnen(
  providers: AiProviderAvailable[],
  gemerkt: number | null,
): number | null {
  const benutzbar = providers.filter((item) => item.available)
  if (gemerkt !== null && benutzbar.some((item) => item.id === gemerkt)) return gemerkt
  return benutzbar[0]?.id ?? null
}

let cachedProviders: AiProviderAvailable[] | null = null

interface UseAiProviderModellOptions {
  userId: string | number
  hasUserId: boolean
  merkSchluessel: AiChatPreferenceKeys
  chatApi: ReturnType<typeof chatScopeApi>
  mountedRef: MutableRefObject<boolean>
  onProviderChange?: (providerId: number | null) => void
}

export function useAiProviderModell({
  userId,
  hasUserId,
  merkSchluessel,
  chatApi,
  mountedRef,
  onProviderChange,
}: UseAiProviderModellOptions) {
  const [providers, setProviders] = useState<AiProviderAvailable[]>(() => cachedProviders ?? [])
  const [providerId, setProviderId] = useState<number | null>(() => {
    const kontoWahl = useAuthStore.getState().user?.ai_provider_id ?? null
    return providerBeimOeffnen(
      cachedProviders ?? [],
      kontoWahl ?? (hasUserId ? readAiProviderChoice(merkSchluessel.provider) : null),
    )
  })
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [modelModalOpen, setModelModalOpen] = useState(false)
  const [modelSearchQuery, setModelSearchQuery] = useState('')
  const [denken, setDenken] = useState<Denkwahl>(
    () => readAiReasoningChoice(merkSchluessel.reasoning) ?? { an: false, stufe: null },
  )
  const [contextStatus, setContextStatus] = useState<AiContextStatus | null>(null)

  const providerRef = useRef<number | null>(null)
  providerRef.current = providerId

  useEffect(() => {
    onProviderChange?.(providerId)
  }, [onProviderChange, providerId])

  useEffect(() => {
    const handlePrefChange = () => {
      const savedProvider = readAiProviderChoice(merkSchluessel.provider)
      if (savedProvider !== null && savedProvider !== providerId) {
        setProviderId(savedProvider)
      }
      const savedReasoning = readAiReasoningChoice(merkSchluessel.reasoning)
      if (savedReasoning !== null) {
        setDenken(savedReasoning)
      }
    }
    window.addEventListener('msm:ai-preference-changed', handlePrefChange)
    return () => {
      window.removeEventListener('msm:ai-preference-changed', handlePrefChange)
    }
  }, [merkSchluessel, providerId])

  const syncGeladeneProviders = useCallback((providerRows: AiProviderAvailable[]) => {
    cachedProviders = providerRows
    setProviders(providerRows)
    const kontoWahl = useAuthStore.getState().user?.ai_provider_id ?? null
    setProviderId(
      providerBeimOeffnen(
        providerRows,
        kontoWahl ?? readAiProviderChoice(merkSchluessel.provider),
      ),
    )
  }, [merkSchluessel.provider])

  const ladeKontext = useCallback(async () => {
    if (!providerId) {
      setContextStatus(null)
      return
    }
    try {
      const status = selectedModel
        ? await chatApi.getContextStatus(providerId, selectedModel)
        : await chatApi.getContextStatus(providerId)
      if (mountedRef.current && providerRef.current === providerId) setContextStatus(status)
    } catch {
      if (mountedRef.current) setContextStatus(null)
    }
  }, [chatApi, mountedRef, providerId, selectedModel])

  useEffect(() => { void ladeKontext() }, [ladeKontext])

  useEffect(() => {
    const handleContextChange = () => {
      void ladeKontext()
    }
    window.addEventListener('msm:ai-context-settings-changed', handleContextChange)
    return () => {
      window.removeEventListener('msm:ai-context-settings-changed', handleContextChange)
    }
  }, [ladeKontext])

  const availableProviders = useMemo(
    () => providers.filter((provider) => provider.available),
    [providers],
  )

  const aktiverProvider = useMemo(
    () => availableProviders.find((provider) => provider.id === providerId) ?? null,
    [availableProviders, providerId],
  )

  useEffect(() => {
    if (!aktiverProvider) {
      setSelectedModel(null)
      return
    }
    const gemerkt = readAiModelChoice(aiModelChoiceKey(userId, aktiverProvider.id))
    if (gemerkt && aktiverProvider.models?.some((m) => m.model_id === gemerkt)) {
      setSelectedModel(gemerkt)
      return
    }
    setSelectedModel((prev) => {
      if (prev && aktiverProvider.models?.some((m) => m.model_id === prev)) return prev
      return aktiverProvider.default_model
    })
  }, [aktiverProvider, userId])

  const aktiverProviderMitModell = useMemo(() => {
    if (!aktiverProvider) return null
    const modelEntry = aktiverProvider.models?.find((m) => m.model_id === (selectedModel || aktiverProvider.default_model))
    if (!modelEntry) return aktiverProvider
    return {
      ...aktiverProvider,
      default_model: modelEntry.model_id,
      reasoning: modelEntry.reasoning,
      efforts: modelEntry.efforts,
      can_disable: modelEntry.can_disable,
      default_effort: modelEntry.default_effort,
    }
  }, [aktiverProvider, selectedModel])

  const providerModelle = useMemo(() => {
    if (!aktiverProvider) return []
    if (aktiverProvider.models && aktiverProvider.models.length > 0) {
      return aktiverProvider.models
    }
    if (aktiverProvider.default_model) {
      return [
        {
          model_id: aktiverProvider.default_model,
          name: aktiverProvider.default_model,
          reasoning: aktiverProvider.reasoning,
          efforts: aktiverProvider.efforts || [],
          can_disable: aktiverProvider.can_disable,
          default_effort: aktiverProvider.default_effort || null,
          vision: null,
        },
      ]
    }
    return []
  }, [aktiverProvider])

  const gefilterteModelle = useMemo(() => {
    const q = modelSearchQuery.trim().toLowerCase()
    if (!q) return providerModelle
    return providerModelle.filter(
      (m) => m.model_id.toLowerCase().includes(q) || (m.name && m.name.toLowerCase().includes(q)),
    )
  }, [providerModelle, modelSearchQuery])

  useEffect(() => {
    if (!aktiverProviderMitModell) return
    const modelKey = selectedModel || aktiverProviderMitModell.default_model
    if (modelKey && aktiverProviderMitModell.id && userId) {
      const gemerkt = readAiModelReasoningChoice(
        aiModelReasoningKey(userId, aktiverProviderMitModell.id, modelKey),
      )
      if (gemerkt) {
        setDenken(denkwahlFuer(gemerkt, aktiverProviderMitModell))
        return
      }
    }
    setDenken((jetzt) => denkwahlFuer(jetzt, aktiverProviderMitModell))
  }, [aktiverProviderMitModell, selectedModel, userId])

  const waehleModell = useCallback((modelId: string) => {
    setSelectedModel(modelId)
    if (aktiverProvider && userId) {
      writeAiModelChoice(aiModelChoiceKey(userId, aktiverProvider.id), modelId)
      const gemerkteDenkwahl = readAiModelReasoningChoice(
        aiModelReasoningKey(userId, aktiverProvider.id, modelId),
      )
      const modelEntry = aktiverProvider.models?.find((m) => m.model_id === modelId)
      const zielProvider: AiProviderAvailable = {
        ...aktiverProvider,
        default_model: modelId,
        reasoning: modelEntry ? modelEntry.reasoning : aktiverProvider.reasoning,
        efforts: modelEntry ? modelEntry.efforts : (aktiverProvider.efforts || []),
        can_disable: modelEntry ? modelEntry.can_disable : aktiverProvider.can_disable,
        default_effort: modelEntry ? modelEntry.default_effort : aktiverProvider.default_effort,
      }
      if (gemerkteDenkwahl) {
        setDenken(denkwahlFuer(gemerkteDenkwahl, zielProvider))
      } else {
        setDenken(denkwahlFuer({ an: true, stufe: null }, zielProvider))
      }
    }
  }, [aktiverProvider, userId])

  const waehleDenken = useCallback((wahl: Denkwahl) => {
    setDenken(wahl)
    writeAiReasoningChoice(merkSchluessel.reasoning, wahl)
    const modelKey = selectedModel || aktiverProvider?.default_model
    if (modelKey && aktiverProvider && userId) {
      writeAiModelReasoningChoice(
        aiModelReasoningKey(userId, aktiverProvider.id, modelKey),
        wahl,
      )
    }
  }, [merkSchluessel.reasoning, selectedModel, aktiverProvider, userId])

  const waehleProvider = useCallback((wert: string) => {
    const id = Number(wert)
    setProviderId(id)
    writeAiProviderChoice(merkSchluessel.provider, id)
    void api<{ ai_provider_id: number | null }>('/auth/me/ai-provider', {
      method: 'PATCH',
      body: JSON.stringify({ provider_id: id }),
    })
      .then((antwort) => useAuthStore.getState().updateUser({ ai_provider_id: antwort.ai_provider_id }))
      .catch(() => undefined)
  }, [merkSchluessel.provider])

  return {
    providerId,
    selectedModel,
    modelModalOpen,
    setModelModalOpen,
    modelSearchQuery,
    setModelSearchQuery,
    denken,
    contextStatus,
    setContextStatus,
    availableProviders,
    aktiverProvider,
    aktiverProviderMitModell,
    providerModelle,
    gefilterteModelle,
    syncGeladeneProviders,
    ladeKontext,
    waehleModell,
    waehleDenken,
    waehleProvider,
  }
}
