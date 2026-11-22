# R8 rules for the Chaotika app. Classes referenced from AndroidManifest.xml and
# layouts are kept automatically by AAPT; only reflection needs explicit rules.

# Keep line numbers so Play Console / logcat stack traces can be deobfuscated
# with mapping.txt (bundled into the AAB automatically).
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Capacitor reads plugin annotations and invokes plugin methods via reflection,
# and loads plugin classes by name from capacitor.plugins.json. The library's
# consumer rules keep Plugin subclasses; keep the bridge and annotations too so
# R8 full mode does not strip annotation members or bridge internals.
-keepattributes RuntimeVisibleAnnotations,RuntimeVisibleParameterAnnotations,AnnotationDefault,Signature,InnerClasses,EnclosingMethod
-keep class com.getcapacitor.** { *; }
-keep @interface com.getcapacitor.annotation.** { *; }
-keep class org.apache.cordova.** { *; }

# Credential Manager loads the Play Services provider by class name.
-if class androidx.credentials.CredentialManager
-keep class androidx.credentials.playservices.** {
  *;
}
