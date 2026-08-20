import React, {forwardRef, useEffect, useImperativeHandle, useRef} from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';
import {WebView, type WebViewMessageEvent} from 'react-native-webview';

import {IN_APP_RENDERER_HTML} from '../visualization/inAppRendererHtml';
import {
  InAppRendererController,
  type InAppRendererSnapshot,
} from '../visualization/inAppRenderer';
import type {CompiledSceneBundle} from '../visualization/inAppTypes';

type WebViewHandle = {postMessage: (message: string) => void};
const NativeWebView = WebView as unknown as React.ForwardRefExoticComponent<
  Record<string, unknown> & React.RefAttributes<WebViewHandle>
>;

export type InAppVisualizationSurfaceHandle = {
  controller: InAppRendererController;
};

export type InAppVisualizationSurfaceProps = {
  bundle?: CompiledSceneBundle;
  runId?: string;
  onSnapshot?: (snapshot: InAppRendererSnapshot) => void;
  style?: StyleProp<ViewStyle>;
};

export const InAppVisualizationSurface = forwardRef<
  InAppVisualizationSurfaceHandle,
  InAppVisualizationSurfaceProps
>(function InAppVisualizationSurface({bundle, runId, onSnapshot, style}, ref) {
  const webViewRef = useRef<WebViewHandle | null>(null);
  const controllerRef = useRef<InAppRendererController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new InAppRendererController(onSnapshot);
  }
  const controller = controllerRef.current;

  useEffect(() => {
    controller.setSnapshotListener(onSnapshot);
  }, [controller, onSnapshot]);

  useImperativeHandle(ref, () => ({controller}), [controller]);

  useEffect(() => {
    controller.attach(webViewRef.current);
    return () => {
      controller.detach();
      controller.dispose().catch(() => undefined);
    };
  }, [controller]);

  useEffect(() => {
    if (!bundle || !runId) return;
    controller.loadProgram(bundle, runId).catch(() => undefined);
  }, [bundle, controller, runId]);

  const onMessage = (event: WebViewMessageEvent) => {
    controller.handleMessage(event.nativeEvent.data);
  };

  return (
    <View style={[styles.container, style]}>
      <NativeWebView
        ref={webViewRef}
        source={{
          html: IN_APP_RENDERER_HTML,
          baseUrl: 'https://pocketpal.invalid',
        }}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled={false}
        originWhitelist={['https://pocketpal.invalid']}
        allowingReadAccessToURL="https://pocketpal.invalid"
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never"
        setSupportMultipleWindows={false}
        setBuiltInZoomControls={false}
        setDisplayZoomControls={false}
        scrollEnabled={false}
        bounces={false}
        style={styles.webView}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: '#1c1c1c',
  },
  webView: {
    backgroundColor: 'transparent',
  },
});
