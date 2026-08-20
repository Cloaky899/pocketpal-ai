import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {completeJson} from '../api/openai';
import {
  InAppVisualizationSurface,
  type InAppVisualizationSurfaceHandle,
} from './InAppVisualizationSurface';
import {loadVisualizationHistory, saveVisualizationHistory} from '../storage';
import type {ApiSettings} from '../types';
import {runInAppVisualization} from '../visualization/inAppPipeline';
import {runVisualization} from '../visualization/pipeline';
import {createRemoteRendererClient} from '../visualization/rendererClient';
import type {InAppVisualizationState} from '../visualization/inAppTypes';
import type {
  AgentState,
  StructuredModelMessage,
  VisualizationHistoryEntry,
  VisualizationRequest,
} from '../visualization/types';

const colors = {
  background: '#101318',
  surface: '#1a2029',
  surfaceRaised: '#232b37',
  border: '#313b4a',
  text: '#f5f7fa',
  muted: '#9aa7b7',
  accent: '#75a7ff',
  danger: '#ff9b9b',
  success: '#8ee6b2',
};

type RenderMode = 'local-first' | 'remote-renderer';

function makeRequestId(): string {
  return `viz-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function initialRequest(
  prompt: string,
  privacyMode: RenderMode,
): VisualizationRequest {
  return {
    schemaVersion: 1,
    requestId: makeRequestId(),
    prompt,
    audience: 'beginner',
    aspectRatio: '16:9',
    durationSeconds: 30,
    quality: privacyMode === 'local-first' ? 'preview' : 'high',
    narration: 'none',
    privacyMode,
  };
}

export function VisualizationWorkspace({
  settings,
  apiKey,
}: {
  settings: ApiSettings;
  apiKey: string;
}) {
  const [prompt, setPrompt] = useState('');
  const [history, setHistory] = useState<VisualizationHistoryEntry[]>([]);
  const [state, setState] = useState<AgentState | null>(null);
  const [localState, setLocalState] = useState<InAppVisualizationState | null>(
    null,
  );
  const [renderMode, setRenderMode] = useState<RenderMode>('local-first');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const surfaceRef = useRef<InAppVisualizationSurfaceHandle>(null);

  useEffect(() => {
    loadVisualizationHistory()
      .then(setHistory)
      .catch(() => setStatus('Could not load visualization history.'));
  }, []);

  const model = useMemo(
    () => ({
      completeJson: async <T,>(messages: StructuredModelMessage[]) =>
        completeJson<T>(settings, apiKey, messages),
    }),
    [apiKey, settings],
  );

  const persistHistory = useCallback(
    async (entry: VisualizationHistoryEntry) => {
      const nextHistory = [entry, ...history].slice(0, 50);
      setHistory(nextHistory);
      await saveVisualizationHistory(nextHistory);
    },
    [history],
  );

  const generate = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      setStatus('Describe what you want to visualize first.');
      return;
    }
    if (!apiKey.trim() || !settings.baseUrl.trim() || !settings.model.trim()) {
      setStatus(
        'Configure the model API key, base URL, and model in Settings.',
      );
      return;
    }
    if (renderMode === 'remote-renderer' && !settings.rendererUrl.trim()) {
      setStatus(
        'Configure the isolated renderer URL for high-fidelity export.',
      );
      return;
    }

    const request = initialRequest(trimmed, renderMode);
    setState(null);
    setLocalState(null);
    setRunning(true);
    setStatus(
      renderMode === 'local-first'
        ? 'Starting local visualization run…'
        : 'Starting high-fidelity visualization run…',
    );
    try {
      if (renderMode === 'local-first') {
        const renderer = surfaceRef.current?.controller;
        if (!renderer)
          throw new Error('The local renderer surface is not ready.');
        const result = await runInAppVisualization({
          request,
          model,
          renderer,
          onState: nextState => {
            setLocalState(nextState);
            setStatus(`Local stage: ${nextState.phase.replaceAll('-', ' ')}`);
          },
        });
        const entry: VisualizationHistoryEntry = {
          requestId: request.requestId,
          title: result.scenePlan?.title ?? 'Untitled visualization',
          prompt: request.prompt,
          phase:
            result.phase === 'completed' || result.phase === 'cancelled'
              ? result.phase
              : 'failed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          artifacts: [],
          renderMode: 'local-first',
          programHash: result.bundle?.contentHash,
          reviewPassed: result.review
            ? !result.review.needsRevision
            : undefined,
          repairAttempt: result.repairAttempt,
          error: result.error,
        };
        await persistHistory(entry);
        setStatus(
          result.phase === 'completed'
            ? 'Local visualization passed review.'
            : (result.error ?? 'Local visualization failed.'),
        );
      } else {
        const renderer = createRemoteRendererClient(settings.rendererUrl);
        const result = await runVisualization({
          request,
          model,
          renderer,
          onState: nextState => {
            setState(nextState);
            setStatus(`Remote stage: ${nextState.phase.replaceAll('-', ' ')}`);
          },
        });
        const entry: VisualizationHistoryEntry = {
          requestId: request.requestId,
          title: result.scenePlan?.title ?? 'Untitled visualization',
          prompt: request.prompt,
          phase:
            result.phase === 'completed' || result.phase === 'cancelled'
              ? result.phase
              : 'failed',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          jobId: result.renderJob?.jobId,
          artifacts: result.artifacts?.artifacts ?? [],
          renderMode: 'remote-renderer',
          reviewPassed: result.review
            ? !result.review.needsRevision
            : undefined,
          repairAttempt: result.repairAttempt,
          error: result.error,
        };
        await persistHistory(entry);
        setStatus(
          result.phase === 'completed'
            ? 'High-fidelity visualization ready.'
            : (result.error ?? 'Visualization failed.'),
        );
      }
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : 'Visualization generation failed.',
      );
    } finally {
      setRunning(false);
    }
  }, [apiKey, model, persistHistory, prompt, renderMode, settings]);

  const openArtifact = useCallback((uri: string) => {
    if (uri) {
      Linking.openURL(uri).catch(() =>
        setStatus('Could not open the artifact.'),
      );
    }
  }, []);

  const activePlan = localState?.scenePlan ?? state?.scenePlan;
  const activeReview = localState?.review ?? state?.review;

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled">
      <Text style={styles.heading}>Manim visualizer</Text>
      <Text style={styles.description}>
        Generate a local, reviewable mathematical animation inside the app. Use
        high-fidelity export only when the full Python renderer is required.
      </Text>
      <TextInput
        editable={!running}
        multiline
        onChangeText={setPrompt}
        placeholder="Explain the derivative of sin(x) visually…"
        placeholderTextColor={colors.muted}
        style={styles.prompt}
        value={prompt}
      />
      <View style={styles.modeRow}>
        {(['local-first', 'remote-renderer'] as RenderMode[]).map(mode => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{selected: renderMode === mode}}
            disabled={running}
            key={mode}
            onPress={() => setRenderMode(mode)}
            style={[
              styles.modeButton,
              renderMode === mode && styles.modeButtonActive,
            ]}>
            <Text
              style={[
                styles.modeText,
                renderMode === mode && styles.modeTextActive,
              ]}>
              {mode === 'local-first'
                ? 'Local preview'
                : 'High-fidelity export'}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          disabled={running}
          onPress={generate}
          style={({pressed}) => [
            styles.primaryButton,
            running && styles.disabled,
            pressed && styles.pressed,
          ]}>
          {running ? (
            <ActivityIndicator color="#08101e" />
          ) : (
            <Text style={styles.primaryText}>Generate visualization</Text>
          )}
        </Pressable>
      </View>
      {status ? (
        <Text
          style={
            localState?.phase === 'completed' || state?.phase === 'completed'
              ? styles.success
              : styles.status
          }>
          {status}
        </Text>
      ) : null}
      <InAppVisualizationSurface ref={surfaceRef} style={styles.preview} />
      {activePlan ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{activePlan.title}</Text>
          <Text style={styles.cardText}>{activePlan.summary}</Text>
          <Text style={styles.meta}>
            {activePlan.scenes.length} scene(s) ·{' '}
            {activePlan.totalDurationSeconds}s planned
          </Text>
        </View>
      ) : null}
      {activeReview ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Self-review</Text>
          <Text style={styles.cardText}>
            {activeReview.needsRevision
              ? 'The agent requested a bounded repair.'
              : 'Technical and visual review passed.'}
          </Text>
          <Text style={styles.meta}>
            {activeReview.technicalChecks.filter(check => check.passed).length}/
            {activeReview.technicalChecks.length} technical checks ·{' '}
            {activeReview.visualChecks.filter(check => check.passed).length}/
            {activeReview.visualChecks.length} visual checks
          </Text>
        </View>
      ) : null}
      {state?.artifacts?.artifacts.length ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Artifacts</Text>
          {state.artifacts.artifacts.map(artifact => (
            <Pressable
              key={`${artifact.kind}-${artifact.uri}`}
              onPress={() => openArtifact(artifact.uri)}
              style={styles.artifactButton}>
              <Text style={styles.artifactText}>
                {artifact.kind.replaceAll('-', ' ')}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Text style={styles.sectionTitle}>Recent visualizations</Text>
      <FlatList
        data={history}
        keyExtractor={entry => entry.requestId}
        scrollEnabled={false}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Your generated visualizations will appear here.
          </Text>
        }
        renderItem={({item}) => (
          <View style={styles.historyItem}>
            <Text style={styles.historyTitle}>{item.title}</Text>
            <Text numberOfLines={2} style={styles.historyPrompt}>
              {item.prompt}
            </Text>
            <Text style={styles.meta}>
              {item.phase} ·{' '}
              {item.renderMode === 'local-first'
                ? 'local preview'
                : 'high fidelity'}{' '}
              · {new Date(item.updatedAt).toLocaleString()}
            </Text>
            {item.reviewPassed !== undefined ? (
              <Text style={item.reviewPassed ? styles.success : styles.status}>
                {item.reviewPassed ? 'Review passed' : 'Review needs attention'}
              </Text>
            ) : null}
            {item.artifacts.map(artifact => (
              <Pressable
                key={`${item.requestId}-${artifact.kind}-${artifact.uri}`}
                onPress={() => openArtifact(artifact.uri)}>
                <Text style={styles.artifactLink}>
                  {artifact.kind.replaceAll('-', ' ')}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {padding: 16, paddingBottom: 28},
  heading: {color: colors.text, fontSize: 22, fontWeight: '700'},
  description: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  prompt: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.text,
    minHeight: 112,
    marginTop: 14,
    padding: 12,
    textAlignVertical: 'top',
  },
  modeRow: {flexDirection: 'row', gap: 8, marginTop: 10},
  modeButton: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    padding: 10,
  },
  modeButtonActive: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.accent,
  },
  modeText: {color: colors.muted, fontSize: 12, textAlign: 'center'},
  modeTextActive: {color: colors.accent, fontWeight: '700'},
  row: {flexDirection: 'row', marginTop: 10},
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 9,
    flex: 1,
    justifyContent: 'center',
    minHeight: 46,
    padding: 12,
  },
  primaryText: {color: '#08101e', fontWeight: '700'},
  disabled: {opacity: 0.65},
  pressed: {opacity: 0.78},
  preview: {height: 230, marginTop: 14, width: '100%'},
  status: {color: colors.danger, fontSize: 12, lineHeight: 17, marginTop: 10},
  success: {color: colors.success, fontSize: 12, lineHeight: 17, marginTop: 10},
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 12,
    padding: 12,
  },
  cardTitle: {color: colors.text, fontSize: 16, fontWeight: '700'},
  cardText: {color: colors.muted, lineHeight: 18, marginTop: 5},
  meta: {color: colors.muted, fontSize: 11, marginTop: 7},
  artifactButton: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
    paddingTop: 8,
  },
  artifactText: {
    color: colors.accent,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 22,
  },
  empty: {color: colors.muted, fontSize: 13, marginTop: 8},
  historyItem: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 9,
    borderWidth: 1,
    marginTop: 8,
    padding: 11,
  },
  historyTitle: {color: colors.text, fontWeight: '700'},
  historyPrompt: {color: colors.muted, lineHeight: 17, marginTop: 4},
  artifactLink: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
    textTransform: 'capitalize',
  },
});
