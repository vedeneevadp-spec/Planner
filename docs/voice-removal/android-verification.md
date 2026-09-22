# Android voice removal audit

## Pre-edit map

| Element                                                               | Consumers                                              | Action                                                                                                 | Risk                            | Verification                        |
| --------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------- | ----------------------------------- |
| Voice runtime/plugin/service/STT/PCM/VAD/embedding/wakeword           | Closed Java subsystem/tests; MainActivity registration | Delete entire subsystem and registration                                                               | Stale references                | Full Java compile, tests, DEX audit |
| openSystemAppSettings                                                 | Notifications settings web page                        | Move to PlannerAppSettings plugin with openSystemAppSettings() and reject errors                       | Settings fail to open           | Build; web helper tests; device gap |
| CapacitorStorage/planner_secure_storage planner.voice.*               | Voice only, other keys shared auth/widget              | Prefix-only removal at startup, never clear prefs or Keystore                                          | Session/widget loss             | Regression fixtures and idempotence |
| planner.voice.training-examples / enabled                             | Voice sample collection only                           | Exact-key removal                                                                                      | Other preferences changed       | Regression fixtures                 |
| Private/external wakeword/haotika/{positive,real-world}               | Personal recordings/datasets                           | Preserve and inventory; no runtime consumer remains                                                    | Irreversible personal file loss | No file deletion in migration       |
| planner-voice-assistant channel / notification 1208 / removed service | WakeWordService only                                   | Stop historical service by explicit component name; cancel exact notification and delete exact channel | Shared notifications affected   | Exact target tests; manifest        |
| ONNX Runtime / LiteRT                                                 | Wakeword only                                          | Delete deps/versions                                                                                   | Transitive libs                 | Dependency/APK audit                |
| RECORD_AUDIO / FOREGROUND_SERVICE_MICROPHONE / FOREGROUND_SERVICE     | Voice only                                             | Delete permissions/service type                                                                        | Transitive contributions        | Merged manifest                     |
| VIBRATE                                                               | Voice and Capacitor push NotificationChannelManager    | Preserve shared permission                                                                             | Push vibration regression       | Consumer inspection                 |
| Voice signals/strings                                                 | AudioFeedbackPlayer/WakeWordService                    | Delete                                                                                                 | Resource references             | Compile                             |
| Parity test/config/fixtures                                           | LiveKit only                                           | Delete tracked files/config                                                                            | Firebase release safeguards     | Build/config checks                 |
| Ignored models                                                        | Wakeword only                                          | Move to temporary inventory location outside source; guard packaging                                   | Reappearance/stale build        | Clean outputs/APK audit             |
| Auth/secure storage/widget/backup/push                                | Active shared features                                 | Preserve                                                                                               | General regression              | Existing unit tests/manifest        |
| iOS/Capacitor config                                                  | No voice matches found in source/config                | No changes                                                                                             | Unnecessary scope               | Source inspection                   |

External Java consumers:
android/app/src/main/java/ru/chaotika/app/MainActivity.java: PlannerVoiceAssistantPlugin
android/app/src/main/java/ru/chaotika/app/PlannerBackupFilesPlugin.java: SaveResult

Planned Java deletions:

- android/app/src/main/java/ru/chaotika/app/AndroidVoiceRuntimeError.java
- android/app/src/main/java/ru/chaotika/app/AndroidVoiceRuntimeMetric.java
- android/app/src/main/java/ru/chaotika/app/AndroidVoiceRuntimePolicy.java
- android/app/src/main/java/ru/chaotika/app/AndroidVoiceRuntimeSampler.java
- android/app/src/main/java/ru/chaotika/app/AndroidVoiceRuntimeStatus.java
- android/app/src/main/java/ru/chaotika/app/AndroidVoiceRuntimeStore.java
- android/app/src/main/java/ru/chaotika/app/AndroidWakeWordAssetSource.java
- android/app/src/main/java/ru/chaotika/app/AudioFeedbackPlayer.java
- android/app/src/main/java/ru/chaotika/app/AudioSignalPlayback.java
- android/app/src/main/java/ru/chaotika/app/AudioSignalPolicy.java
- android/app/src/main/java/ru/chaotika/app/BackendSpeechToTextService.java
- android/app/src/main/java/ru/chaotika/app/CommandAudio.java
- android/app/src/main/java/ru/chaotika/app/CommandAudioPreBuffer.java
- android/app/src/main/java/ru/chaotika/app/CommandAudioRecorder.java
- android/app/src/main/java/ru/chaotika/app/CommandRecordingConfig.java
- android/app/src/main/java/ru/chaotika/app/CommandRecordingObserver.java
- android/app/src/main/java/ru/chaotika/app/CommandRecordingVad.java
- android/app/src/main/java/ru/chaotika/app/CustomOnnxWakeWordEngine.java
- android/app/src/main/java/ru/chaotika/app/CustomTfliteWakeWordEngine.java
- android/app/src/main/java/ru/chaotika/app/EmbeddingModelOnnxRunner.java
- android/app/src/main/java/ru/chaotika/app/HybridSpeechToTextService.java
- android/app/src/main/java/ru/chaotika/app/LiveKitFeatureExtractor.java
- android/app/src/main/java/ru/chaotika/app/LiveKitOnnxOfflineScorer.java
- android/app/src/main/java/ru/chaotika/app/LiveKitOnnxWakeWordEngine.java
- android/app/src/main/java/ru/chaotika/app/LocalSpeechToTextServiceStub.java
- android/app/src/main/java/ru/chaotika/app/MelSpectrogramOnnxRunner.java
- android/app/src/main/java/ru/chaotika/app/MockWakeWordEngine.java
- android/app/src/main/java/ru/chaotika/app/OnnxWakeWordSessionOptions.java
- android/app/src/main/java/ru/chaotika/app/Pcm16AudioActivity.java
- android/app/src/main/java/ru/chaotika/app/PlannerVoiceAssistantPlugin.java
- android/app/src/main/java/ru/chaotika/app/PlannerVoiceAssistantStorage.java
- android/app/src/main/java/ru/chaotika/app/RecordedSpeechToTextProvider.java
- android/app/src/main/java/ru/chaotika/app/RollingEmbeddingBuffer.java
- android/app/src/main/java/ru/chaotika/app/SpeechToTextService.java
- android/app/src/main/java/ru/chaotika/app/SpeechToTextServiceFactory.java
- android/app/src/main/java/ru/chaotika/app/SttError.java
- android/app/src/main/java/ru/chaotika/app/SttException.java
- android/app/src/main/java/ru/chaotika/app/SttMetricsLogger.java
- android/app/src/main/java/ru/chaotika/app/SttProvider.java
- android/app/src/main/java/ru/chaotika/app/SttRequest.java
- android/app/src/main/java/ru/chaotika/app/SttResult.java
- android/app/src/main/java/ru/chaotika/app/SttSource.java
- android/app/src/main/java/ru/chaotika/app/StubSpeechToTextService.java
- android/app/src/main/java/ru/chaotika/app/UnavailableWakeWordEngine.java
- android/app/src/main/java/ru/chaotika/app/VoiceAssistantApiConfig.java
- android/app/src/main/java/ru/chaotika/app/VoiceAssistantState.java
- android/app/src/main/java/ru/chaotika/app/VoiceAssistantStateMachine.java
- android/app/src/main/java/ru/chaotika/app/VoiceAudioUploadGuard.java
- android/app/src/main/java/ru/chaotika/app/WakeWordAssetSource.java
- android/app/src/main/java/ru/chaotika/app/WakeWordClassifierOnnxRunner.java
- android/app/src/main/java/ru/chaotika/app/WakeWordConfig.java
- android/app/src/main/java/ru/chaotika/app/WakeWordDebugActivity.java
- android/app/src/main/java/ru/chaotika/app/WakeWordDetection.java
- android/app/src/main/java/ru/chaotika/app/WakeWordDiagnostics.java
- android/app/src/main/java/ru/chaotika/app/WakeWordEngine.java
- android/app/src/main/java/ru/chaotika/app/WakeWordEngineFactory.java
- android/app/src/main/java/ru/chaotika/app/WakeWordError.java
- android/app/src/main/java/ru/chaotika/app/WakeWordListener.java
- android/app/src/main/java/ru/chaotika/app/WakeWordMetricsLogger.java
- android/app/src/main/java/ru/chaotika/app/WakeWordModelFrontend.java
- android/app/src/main/java/ru/chaotika/app/WakeWordModelInputKind.java
- android/app/src/main/java/ru/chaotika/app/WakeWordModelManifest.java
- android/app/src/main/java/ru/chaotika/app/WakeWordProvider.java
- android/app/src/main/java/ru/chaotika/app/WakeWordSamplePlayback.java
- android/app/src/main/java/ru/chaotika/app/WakeWordSampleProcessor.java
- android/app/src/main/java/ru/chaotika/app/WakeWordSampleRecorderActivity.java
- android/app/src/main/java/ru/chaotika/app/WakeWordService.java
- android/app/src/main/java/ru/chaotika/app/WakeWordTrainingExampleStore.java
- android/app/src/main/java/ru/chaotika/app/WakeWordTrainingExamplesActivity.java
- android/app/src/main/java/ru/chaotika/app/WakeWordTriggerReviewActivity.java

Ignored model inventory:

- android/app/src/main/assets/wakewords/haotika.onnx: 177849 bytes; SHA-256 25f70409b16f86a979e751c83932c6d592a374014f96fb40802e09050558b8e3
- android/app/src/main/assets/wakewords/haotika.tflite: 263804 bytes; SHA-256 47ef30de5a9008315e05be3bd477bc533bde2e3000746e3a63e38a6a8dfa4ff8
- android/app/src/main/assets/wakewords/livekit/embedding_model.onnx: 1326578 bytes; SHA-256 70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f
- android/app/src/main/assets/wakewords/livekit/melspectrogram.onnx: 1087958 bytes; SHA-256 ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f

## Baseline

Initial JDK21 Gradle command blocked by sandbox write permission for ~/.gradle wrapper lock. Retrying with approved build access.
System /usr/bin/python3 unusable due existing Xcode loader error; Node used instead (no repository failure).
Build parameters: debug, default ABI filters, JAVA_HOME=/Applications/Android Studio.app/Contents/jbr/Contents/Home.

Baseline PASS: tests=104, failures=0, errors=0, skipped=0; APK 153332747 bytes, SHA-256 2dea15e12bed379d797dd04664e52e75f72169b21f01147ebc1a6168e301683a. Build successful in 8s. Full log /tmp/planner-voice-android-baseline.log.
Backup SaveResult match is a nested class local to PlannerBackupFilesPlugin, not a dependency on voice SaveResult.
Correction: training preference exact key is wake-word-training-opt-in (not enabled).

Moved 4 ignored model files without destroying them to /tmp/planner-retired-voice-models; tracked model manifest/readmes deleted. No ignored personal audio/parity dataset files found in Android source assets. Existing private-device positive/real-world recordings are retained, not purged.

## First native verification

Clean JDK21 testDebugUnitTest + assembleDebug PASS (13s); 22 tests, 0 failures/errors/skips, including 5 selective cleanup tests. Full log /tmp/planner-voice-android-after.log.
Merged manifest and aapt permissions contain no RECORD_AUDIO, FOREGROUND_SERVICE, FOREGROUND_SERVICE_MICROPHONE or microphone service type. Firebase messaging/push receivers/services, widget providers/services and POST_NOTIFICATIONS preserved. WAKE_LOCK comes transitively from Firebase, kept.
APK native libraries: only libdatastore_shared_counter.so for arm64-v8a, armeabi-v7a, x86, x86_64; no ONNX/LiteRT/model/signal paths. Current synced web was old, so this APK is not final and still carries old web voice chunks pending parent web sync.
ADB initially blocked by sandbox smartsocket; approved read-only adb devices -l succeeded with empty device list. No device installation or data modification performed. Native app launch, live settings launch, foreground/background and upgrade-over-old-install scenarios remain unverified.
Pre-existing source finding: android/app/src/androidTest/java/com/getcapacitor/myapp/ExampleInstrumentedTest.java expects com.getcapacitor.app while actual applicationId is ru.chaotika.app. Retained unchanged; instrumented test not run because no device.
System /usr/bin/python3 error is environmental; no iOS voice/microphone references found in native source/config, so no iOS changes.

## FINAL verification

After parent fresh mobile:sync:android, final clean JDK21 :app:testDebugUnitTest :app:assembleDebug PASS in 13s; {"tests":22,"failures":0,"errors":0,"skipped":0}. Baseline and final use identical Gradle debug/default ABI settings and unchanged applicationId/version/signing configuration. No release build/signing/publishing was requested or performed; assembleDebug uses standard debug tooling.

- Fresh web sync environment supplied by parent: MOBILE_ENV_FILE='', VITE_API_BASE_URL=http://127.0.0.1:3001, VITE_AUTH_PROVIDER=planner. APK is a local test build, not a production delivery artifact.
- Final APK: android/app/build/outputs/apk/debug/app-debug.apk; 8051935 bytes, SHA-256 795b137c48961ea642a67f7fce43e43bb6fb8ac8809964f9c7bffbc9b90eb740.
- Baseline APK: 153332747 bytes, final reduction 145280812 bytes (94.75%). Baseline contains its pre-change bundled web; final contains newly built web. Comparison measures total delivered APK change, not attribution exclusively to native libraries.
- npm run mobile:android:budget PASS: 7.7 MB / 180.0 MB.
- DEX audit: 8772 defined classes, zero definitions for all 70 removed native classes or nested classes; zero ONNX Runtime/TensorFlow/LiteRT definitions. Shared auth/secure/widget/backup classes and new neutral settings plugin present.
- ZIP audit: zero voice web chunks, /api/voice/{command,metrics}, MediaRecorder/getUserMedia/SpeechRecognition in web JS; no model files or voice raw signals; no recognition native libraries. Only libdatastore_shared_counter.so remains for arm64-v8a/armeabi-v7a/x86/x86_64.
- Packaging regression verified by placing temporary .onnx, .tflite and wakewords/ directory sentinel files into source assets before the final build: all excluded from final APK by aapt configuration. Sentinels removed after successful audit.
- Gradle debugRuntimeClasspath report PASS: no ONNX/LiteRT/TensorFlow dependency (file /tmp/planner-voice-android-dependencies.log).
- Merged manifest and aapt permissions PASS: no RECORD_AUDIO, FOREGROUND_SERVICE, FOREGROUND_SERVICE_MICROPHONE, microphone type, WakeWord service/activities or voice plugin. POST_NOTIFICATIONS/Firebase/notification icon and channels/widget services preserved.
- git diff --check -- android PASS.
- Source assets: no remaining .onnx/.tflite/audio sample files or parity fixtures. Four original model binaries are preserved only under /tmp/planner-retired-voice-models outside product sources.

### Cleanup boundaries and upgrade limitations

PlannerAppUpgradeCleanup runs from MainActivity before BridgeActivity startup, independently of all plugins. It stops only the historical ru.chaotika.app.WakeWordService component, removes only planner.voice.* keys from CapacitorStorage/planner_secure_storage (ciphertext removal without decryption), removes only wake-word-training-opt-in from planner.voice.training-examples, cancels only notification 1208, and deletes only channel planner-voice-assistant. No migration-completed flag prevents retry or restored-data cleanup. Separate failure isolation keeps app launch viable and ensures one failed store does not skip another.

No general storage clear(), Keystore access, session/token mutation, widget mutation, offline queue mutation, or shared-directory deletion is introduced. Source and manifest deletion prevent service restart/pending-command consumption by the new binary.

Recorded personal files were produced only under getExternalFilesDir()/wakeword/haotika/positive and /real-world (getFilesDir() fallback). No disposable persisted runtime audio files were found; command PCM lived in memory. Personal recording directories are deliberately preserved as required by the explicit no-destruction rule. There is no retained runtime reader/uploader. Their on-device existence/content was not inspected because no device is connected. Local dataset/audio inventories outside Android belong to parent report.

### Remaining classified Android references

- PlannerAppUpgradeCleanup: historical service component/name, voice storage namespace/channel and preserved-recording comment = migration cleanup and personal-data preservation, not active voice runtime.
- PlannerAppUpgradeCleanupTest: old keys/ciphertext fixtures = compatibility/cleanup regression tests.
- app/build.gradle: _.onnx/_.tflite/wakewords exclusions = packaging safeguard against restored ignored assets.
- .gitignore preserved by parent: local model/dataset patterns = privacy/build hygiene.
- No real iOS voice dependency found; no iOS changes made.

### Explicit gaps / original findings

No adb-connected device/emulator. Cannot verify installed app launch, real Android settings screen, foreground/background transitions, or data-preserving upgrade with old enabled service, auth, widgets, offline outbox and pending command. Unit fixtures and APK/manifest evidence do not establish physical-device behavior. No personal device installation performed.

Existing instrumentation ExampleInstrumentedTest expects wrong legacy applicationId com.getcapacitor.app; source left unchanged. Instrumentation not run. Existing Gradle deprecation and libdatastore stripping warnings appear in successful build. System Xcode/Python error and initial Gradle/ADB sandbox restrictions are environmental; approved build/read-only ADB retries succeeded.

### Changed tracked Android files

M android/app/build.gradle
D android/app/src/androidTest/assets/wakeword-parity/README.md
D android/app/src/androidTest/assets/wakeword-parity/expected/.gitkeep
D android/app/src/androidTest/assets/wakeword-parity/input/.gitkeep
D android/app/src/androidTest/java/ru/chaotika/app/LiveKitAndroidParityInstrumentedTest.java
M android/app/src/main/AndroidManifest.xml
D android/app/src/main/assets/wakewords/README.md
D android/app/src/main/assets/wakewords/haotika_manifest.json
D android/app/src/main/assets/wakewords/livekit/README.md
D android/app/src/main/java/ru/chaotika/app/AndroidVoiceRuntimeError.java
D android/app/src/main/java/ru/chaotika/app/AndroidVoiceRuntimeMetric.java
D android/app/src/main/java/ru/chaotika/app/AndroidVoiceRuntimePolicy.java
D android/app/src/main/java/ru/chaotika/app/AndroidVoiceRuntimeSampler.java
D android/app/src/main/java/ru/chaotika/app/AndroidVoiceRuntimeStatus.java
D android/app/src/main/java/ru/chaotika/app/AndroidVoiceRuntimeStore.java
D android/app/src/main/java/ru/chaotika/app/AndroidWakeWordAssetSource.java
D android/app/src/main/java/ru/chaotika/app/AudioFeedbackPlayer.java
D android/app/src/main/java/ru/chaotika/app/AudioSignalPlayback.java
D android/app/src/main/java/ru/chaotika/app/AudioSignalPolicy.java
D android/app/src/main/java/ru/chaotika/app/BackendSpeechToTextService.java
D android/app/src/main/java/ru/chaotika/app/CommandAudio.java
D android/app/src/main/java/ru/chaotika/app/CommandAudioPreBuffer.java
D android/app/src/main/java/ru/chaotika/app/CommandAudioRecorder.java
D android/app/src/main/java/ru/chaotika/app/CommandRecordingConfig.java
D android/app/src/main/java/ru/chaotika/app/CommandRecordingObserver.java
D android/app/src/main/java/ru/chaotika/app/CommandRecordingVad.java
D android/app/src/main/java/ru/chaotika/app/CustomOnnxWakeWordEngine.java
D android/app/src/main/java/ru/chaotika/app/CustomTfliteWakeWordEngine.java
D android/app/src/main/java/ru/chaotika/app/EmbeddingModelOnnxRunner.java
D android/app/src/main/java/ru/chaotika/app/HybridSpeechToTextService.java
D android/app/src/main/java/ru/chaotika/app/LiveKitFeatureExtractor.java
D android/app/src/main/java/ru/chaotika/app/LiveKitOnnxOfflineScorer.java
D android/app/src/main/java/ru/chaotika/app/LiveKitOnnxWakeWordEngine.java
D android/app/src/main/java/ru/chaotika/app/LocalSpeechToTextServiceStub.java
M android/app/src/main/java/ru/chaotika/app/MainActivity.java
D android/app/src/main/java/ru/chaotika/app/MelSpectrogramOnnxRunner.java
D android/app/src/main/java/ru/chaotika/app/MockWakeWordEngine.java
D android/app/src/main/java/ru/chaotika/app/OnnxWakeWordSessionOptions.java
D android/app/src/main/java/ru/chaotika/app/Pcm16AudioActivity.java
D android/app/src/main/java/ru/chaotika/app/PlannerVoiceAssistantPlugin.java
D android/app/src/main/java/ru/chaotika/app/PlannerVoiceAssistantStorage.java
D android/app/src/main/java/ru/chaotika/app/RecordedSpeechToTextProvider.java
D android/app/src/main/java/ru/chaotika/app/RollingEmbeddingBuffer.java
D android/app/src/main/java/ru/chaotika/app/SpeechToTextService.java
D android/app/src/main/java/ru/chaotika/app/SpeechToTextServiceFactory.java
D android/app/src/main/java/ru/chaotika/app/SttError.java
D android/app/src/main/java/ru/chaotika/app/SttException.java
D android/app/src/main/java/ru/chaotika/app/SttMetricsLogger.java
D android/app/src/main/java/ru/chaotika/app/SttProvider.java
D android/app/src/main/java/ru/chaotika/app/SttRequest.java
D android/app/src/main/java/ru/chaotika/app/SttResult.java
D android/app/src/main/java/ru/chaotika/app/SttSource.java
D android/app/src/main/java/ru/chaotika/app/StubSpeechToTextService.java
D android/app/src/main/java/ru/chaotika/app/UnavailableWakeWordEngine.java
D android/app/src/main/java/ru/chaotika/app/VoiceAssistantApiConfig.java
D android/app/src/main/java/ru/chaotika/app/VoiceAssistantState.java
D android/app/src/main/java/ru/chaotika/app/VoiceAssistantStateMachine.java
D android/app/src/main/java/ru/chaotika/app/VoiceAudioUploadGuard.java
D android/app/src/main/java/ru/chaotika/app/WakeWordAssetSource.java
D android/app/src/main/java/ru/chaotika/app/WakeWordClassifierOnnxRunner.java
D android/app/src/main/java/ru/chaotika/app/WakeWordConfig.java
D android/app/src/main/java/ru/chaotika/app/WakeWordDebugActivity.java
D android/app/src/main/java/ru/chaotika/app/WakeWordDetection.java
D android/app/src/main/java/ru/chaotika/app/WakeWordDiagnostics.java
D android/app/src/main/java/ru/chaotika/app/WakeWordEngine.java
D android/app/src/main/java/ru/chaotika/app/WakeWordEngineFactory.java
D android/app/src/main/java/ru/chaotika/app/WakeWordError.java
D android/app/src/main/java/ru/chaotika/app/WakeWordListener.java
D android/app/src/main/java/ru/chaotika/app/WakeWordMetricsLogger.java
D android/app/src/main/java/ru/chaotika/app/WakeWordModelFrontend.java
D android/app/src/main/java/ru/chaotika/app/WakeWordModelInputKind.java
D android/app/src/main/java/ru/chaotika/app/WakeWordModelManifest.java
D android/app/src/main/java/ru/chaotika/app/WakeWordProvider.java
D android/app/src/main/java/ru/chaotika/app/WakeWordSamplePlayback.java
D android/app/src/main/java/ru/chaotika/app/WakeWordSampleProcessor.java
D android/app/src/main/java/ru/chaotika/app/WakeWordSampleRecorderActivity.java
D android/app/src/main/java/ru/chaotika/app/WakeWordService.java
D android/app/src/main/java/ru/chaotika/app/WakeWordTrainingExampleStore.java
D android/app/src/main/java/ru/chaotika/app/WakeWordTrainingExamplesActivity.java
D android/app/src/main/java/ru/chaotika/app/WakeWordTriggerReviewActivity.java
D android/app/src/main/res/raw/voice_signal_start.ogg
D android/app/src/main/res/raw/voice_signal_success.ogg
M android/app/src/main/res/values/strings.xml
D android/app/src/test/java/ru/chaotika/app/AndroidVoiceRuntimeModelTest.java
D android/app/src/test/java/ru/chaotika/app/AudioSignalPolicyTest.java
D android/app/src/test/java/ru/chaotika/app/CommandAudioTest.java
D android/app/src/test/java/ru/chaotika/app/VoiceAudioUploadGuardTest.java
D android/app/src/test/java/ru/chaotika/app/WakeWordEngineTest.java
D android/app/src/test/java/ru/chaotika/app/WakeWordSampleProcessorTest.java
M android/variables.gradle

### Added Android files

android/app/src/main/java/ru/chaotika/app/PlannerAppSettingsPlugin.java
android/app/src/main/java/ru/chaotika/app/PlannerAppUpgradeCleanup.java
android/app/src/test/java/ru/chaotika/app/PlannerAppUpgradeCleanupTest.java
