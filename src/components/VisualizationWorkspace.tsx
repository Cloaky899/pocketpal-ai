import React, {useCallback, useEffect, useMemo, useState} from 'react';
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
import {loadVisualizationHistory, saveVisualizationHistory} from '../storage';
import {ApiSettings} from '../types';
import {runVisualization} from '../visualization/pipeline';
import {createRemoteRendererClient} from '../visualization/rendererClient';
import {
  AgentState,
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

function makeRequestId(): string {
  return `viz-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function initialRequest(prompt: string): VisualizationRequest {
  return {
    schemaVersion: 1,
    requestId: makeRequestId(),
    prompt,
    audience: 'beginner',
    aspectRatio: '16:9',
    durationSeconds: 30,
    quality: 'preview',
    narration: 'none',
    privacyMode: 'remote-renderer',
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
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    loadVisualizationHistory()
      .then(setHistory)
      .catch(() => setStatus('Could not load visualization history.'));
  }, []);

  const model = useMemo(
    () => ({
      completeJson: async <T,>(
        messages: Array<{
          role: 'system' | 'user' | 'assistant';
          content: string;
        }>,
      ) => completeJson<T>(settings, apiKey, messages),
    }),
    [apiKey, settings],
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
    if (!settings.rendererUrl.trim()) {
      setStatus('Configure the isolated renderer URL in Settings.');
      return;
    }

    const request = initialRequest(trimmed);
    const renderer = createRemoteRendererClient(settings.rendererUrl);
    setRunning(true);
    setStatus('Starting autonomous visualization run…');
    try {
      const result = await runVisualization({
        request,
        model,
        renderer,
        onState: nextState => {
          setState(nextState);
          setStatus(`Stage: ${nextState.phase.replaceAll('-', ' ')}`);
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
        error: result.error,
      };
      const nextHistory = [entry, ...history].slice(0, 50);
      setHistory(nextHistory);
      await saveVisualizationHistory(nextHistory);
      setStatus(
        result.phase === 'completed'
          ? 'Visualization ready.'
          : (result.error ?? 'Visualization failed.'),
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : 'Visualization generation failed.',
      );
    } finally {
      setRunning(false);
    }
  }, [apiKey, history, model, prompt, settings]);

  const openArtifact = useCallback((uri: string) => {
    if (uri)
      Linking.openURL(uri).catch(() =>
        setStatus('Could not open the artifact.'),
      );
  }, []);

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled">
      <Text style={styles.heading}>Manim visualizer</Text>
      <Text style={styles.description}>
        Describe a concept. The agent plans scenes, writes Manim code, renders a
        preview, and repairs failures before returning a video.
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
          style={state?.phase === 'completed' ? styles.success : styles.status}>
          {status}
        </Text>
      ) : null}
      {state?.scenePlan ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{state.scenePlan.title}</Text>
          <Text style={styles.cardText}>{state.scenePlan.summary}</Text>
          <Text style={styles.meta}>
            {state.scenePlan.scenes.length} scene(s) ·{' '}
            {state.scenePlan.totalDurationSeconds}s planned
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
              {item.phase} · {new Date(item.updatedAt).toLocaleString()}
            </Text>
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
