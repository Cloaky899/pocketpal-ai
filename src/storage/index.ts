import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

import {ApiSettings, ChatMessage, DEFAULT_SETTINGS} from '../types';
import {VisualizationHistoryEntry} from '../visualization/types';

const SETTINGS_KEY = '@mobigpt/settings/v1';
const MESSAGES_KEY = '@mobigpt/messages/v1';
const VISUALIZATION_HISTORY_KEY = '@mobigpt/visualizations/v1';
const KEYCHAIN_SERVICE = 'com.pocketpallite.mobigpt.api-key';

export async function loadSettings(): Promise<ApiSettings> {
  const stored = await AsyncStorage.getItem(SETTINGS_KEY);
  if (!stored) {
    return DEFAULT_SETTINGS;
  }

  try {
    return {
      ...DEFAULT_SETTINGS,
      ...(JSON.parse(stored) as Partial<ApiSettings>),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: ApiSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function loadApiKey(): Promise<string> {
  const credentials = await Keychain.getGenericPassword({
    service: KEYCHAIN_SERVICE,
  });
  return credentials ? credentials.password : '';
}

export async function saveApiKey(apiKey: string): Promise<void> {
  if (apiKey.trim()) {
    await Keychain.setGenericPassword('api-key', apiKey.trim(), {
      service: KEYCHAIN_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } else {
    await Keychain.resetGenericPassword({service: KEYCHAIN_SERVICE});
  }
}

export async function loadMessages(): Promise<ChatMessage[]> {
  const stored = await AsyncStorage.getItem(MESSAGES_KEY);
  if (!stored) {
    return [];
  }

  try {
    return JSON.parse(stored) as ChatMessage[];
  } catch {
    return [];
  }
}

export async function saveMessages(messages: ChatMessage[]): Promise<void> {
  await AsyncStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
}

export async function clearMessages(): Promise<void> {
  await AsyncStorage.removeItem(MESSAGES_KEY);
}

export async function loadVisualizationHistory(): Promise<
  VisualizationHistoryEntry[]
> {
  const stored = await AsyncStorage.getItem(VISUALIZATION_HISTORY_KEY);
  if (!stored) {
    return [];
  }

  try {
    const parsed = JSON.parse(stored) as unknown;
    return Array.isArray(parsed)
      ? (parsed as VisualizationHistoryEntry[]).slice(0, 50)
      : [];
  } catch {
    return [];
  }
}

export async function saveVisualizationHistory(
  entries: VisualizationHistoryEntry[],
): Promise<void> {
  await AsyncStorage.setItem(
    VISUALIZATION_HISTORY_KEY,
    JSON.stringify(entries.slice(0, 50)),
  );
}

export async function clearVisualizationHistory(): Promise<void> {
  await AsyncStorage.removeItem(VISUALIZATION_HISTORY_KEY);
}
