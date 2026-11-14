package ru.chaotika.app;

import android.os.CancellationSignal;
import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.credentials.ClearCredentialStateRequest;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

@CapacitorPlugin(name = "PlannerGoogleSignIn")
public class PlannerGoogleSignInPlugin extends Plugin {
    private CancellationSignal pendingSignIn;

    @PluginMethod
    public void signIn(PluginCall call) {
        String clientId = call.getString("clientId");
        String nonce = call.getString("nonce");
        if (clientId == null || !clientId.matches("[a-zA-Z0-9_-]+\\.apps\\.googleusercontent\\.com")
            || nonce == null || nonce.length() < 32 || nonce.length() > 128) {
            call.reject("A Google web client id and nonce are required.", "GOOGLE_SIGN_IN_INVALID_INPUT");
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (pendingSignIn != null) {
                call.reject("Google sign-in is already open.", "GOOGLE_SIGN_IN_PENDING");
                return;
            }
            pendingSignIn = new CancellationSignal();
            try {
                GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(clientId)
                    .setNonce(nonce).build();
                GetCredentialRequest request = new GetCredentialRequest.Builder()
                    .addCredentialOption(option).build();
                CredentialManager.create(getContext()).getCredentialAsync(
                    getActivity(), request, pendingSignIn,
                    ContextCompat.getMainExecutor(getContext()),
                    new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                        @Override
                        public void onResult(GetCredentialResponse result) {
                            pendingSignIn = null;
                            Credential credential = result.getCredential();
                            if (!(credential instanceof CustomCredential)
                                || !GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())) {
                                call.reject("Unexpected Google credential.", "GOOGLE_SIGN_IN_INVALID_CREDENTIAL");
                                return;
                            }
                            try {
                                GoogleIdTokenCredential google = GoogleIdTokenCredential.createFrom(credential.getData());
                                JSObject response = new JSObject();
                                response.put("idToken", google.getIdToken());
                                call.resolve(response);
                            } catch (Exception exception) {
                                call.reject("Could not read Google credential.", "GOOGLE_SIGN_IN_INVALID_CREDENTIAL");
                            }
                        }

                        @Override
                        public void onError(@NonNull GetCredentialException error) {
                            pendingSignIn = null;
                            call.reject("Google sign-in did not complete.",
                                error instanceof GetCredentialCancellationException
                                    ? "GOOGLE_SIGN_IN_CANCELLED" : "GOOGLE_SIGN_IN_FAILED");
                        }
                    }
                );
            } catch (RuntimeException exception) {
                pendingSignIn = null;
                call.reject("Google sign-in is unavailable.", "GOOGLE_SIGN_IN_FAILED");
            }
        });
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        CredentialManager.create(getContext()).clearCredentialStateAsync(
            new ClearCredentialStateRequest(), null, ContextCompat.getMainExecutor(getContext()),
            new CredentialManagerCallback<Void, ClearCredentialException>() {
                @Override
                public void onResult(Void result) { call.resolve(); }

                @Override
                public void onError(@NonNull ClearCredentialException error) {
                    call.reject("Could not clear Google sign-in state.", "GOOGLE_SIGN_OUT_FAILED");
                }
            }
        );
    }

    @Override
    protected void handleOnDestroy() {
        if (pendingSignIn != null) {
            pendingSignIn.cancel();
            pendingSignIn = null;
        }
        super.handleOnDestroy();
    }
}
