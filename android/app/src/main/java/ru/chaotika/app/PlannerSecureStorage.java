package ru.chaotika.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class PlannerSecureStorage {

    private static final String ANDROID_KEY_STORE = "AndroidKeyStore";
    private static final String CIPHER_TRANSFORMATION = "AES/GCM/NoPadding";
    private static final String KEY_ALIAS = "planner.auth.secure-storage.v1";
    private static final String PREFERENCES_NAME = "planner_secure_storage";
    private static final String VALUE_PREFIX = "v1";

    private PlannerSecureStorage() {}

    static String getString(Context context, String key, String legacyPreferencesName) {
        SharedPreferences securePreferences = getSecurePreferences(context);
        String storedValue = securePreferences.getString(key, null);

        if (storedValue != null) {
            return decrypt(key, storedValue);
        }

        SharedPreferences legacyPreferences = getPreferences(context, legacyPreferencesName);
        String legacyValue = legacyPreferences.getString(key, null);

        if (legacyValue == null) {
            return null;
        }

        if (!putString(context, key, legacyValue, legacyPreferencesName)) {
            throw new IllegalStateException("Failed to migrate secure storage value.");
        }

        return legacyValue;
    }

    static boolean putString(
        Context context,
        String key,
        String value,
        String legacyPreferencesName
    ) {
        boolean secureStored = getSecurePreferences(context)
            .edit()
            .putString(key, encrypt(key, value))
            .commit();

        if (!secureStored) {
            return false;
        }

        return getPreferences(context, legacyPreferencesName).edit().remove(key).commit();
    }

    static boolean remove(Context context, String key, String legacyPreferencesName) {
        boolean secureRemoved = getSecurePreferences(context).edit().remove(key).commit();
        boolean legacyRemoved = getPreferences(context, legacyPreferencesName).edit().remove(key).commit();

        return secureRemoved && legacyRemoved;
    }

    private static String encrypt(String key, String value) {
        try {
            Cipher cipher = Cipher.getInstance(CIPHER_TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            cipher.updateAAD(key.getBytes(StandardCharsets.UTF_8));
            byte[] encryptedValue = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));

            return VALUE_PREFIX
                + ":"
                + Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)
                + ":"
                + Base64.encodeToString(encryptedValue, Base64.NO_WRAP);
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("Failed to encrypt secure storage value.", exception);
        }
    }

    private static String decrypt(String key, String storedValue) {
        String[] parts = storedValue.split(":", 3);

        if (parts.length != 3 || !VALUE_PREFIX.equals(parts[0])) {
            throw new IllegalStateException("Unsupported secure storage value.");
        }

        try {
            byte[] initializationVector = Base64.decode(parts[1], Base64.NO_WRAP);
            byte[] encryptedValue = Base64.decode(parts[2], Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance(CIPHER_TRANSFORMATION);
            cipher.init(
                Cipher.DECRYPT_MODE,
                getOrCreateKey(),
                new GCMParameterSpec(128, initializationVector)
            );
            cipher.updateAAD(key.getBytes(StandardCharsets.UTF_8));

            return new String(cipher.doFinal(encryptedValue), StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException exception) {
            throw new IllegalStateException("Failed to decrypt secure storage value.", exception);
        }
    }

    private static synchronized SecretKey getOrCreateKey() throws GeneralSecurityException {
        final KeyStore keyStore;

        try {
            keyStore = KeyStore.getInstance(ANDROID_KEY_STORE);
            keyStore.load(null);
        } catch (Exception exception) {
            throw new GeneralSecurityException("Failed to load Android Keystore.", exception);
        }

        java.security.Key existingKey = keyStore.getKey(KEY_ALIAS, null);

        if (existingKey instanceof SecretKey) {
            return (SecretKey) existingKey;
        }

        KeyGenerator keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            ANDROID_KEY_STORE
        );
        keyGenerator.init(
            new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        );

        return keyGenerator.generateKey();
    }

    private static SharedPreferences getSecurePreferences(Context context) {
        return getPreferences(context, PREFERENCES_NAME);
    }

    private static SharedPreferences getPreferences(Context context, String name) {
        return context.getApplicationContext().getSharedPreferences(name, Context.MODE_PRIVATE);
    }
}
