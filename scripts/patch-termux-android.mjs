import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const androidRoot = resolve(root, "android");
const javaRoot = resolve(
  androidRoot,
  "app",
  "src",
  "main",
  "java",
  "com",
  "novatron",
  "k3nova",
);
const manifestPath = resolve(
  androidRoot,
  "app",
  "src",
  "main",
  "AndroidManifest.xml",
);
const xmlRoot = resolve(
  androidRoot,
  "app",
  "src",
  "main",
  "res",
  "xml",
);

mkdirSync(javaRoot, { recursive: true });
mkdirSync(xmlRoot, { recursive: true });

const pluginSource = `package com.novatron.k3nova;

import android.content.ComponentName;
import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "TermuxBridge",
    permissions = {
        @Permission(
            alias = "runCommand",
            strings = { "com.termux.permission.RUN_COMMAND" }
        )
    }
)
public class TermuxBridgePlugin extends Plugin {
    private static final String TERMUX_PACKAGE = "com.termux";
    private static final String RUN_COMMAND_SERVICE = "com.termux.app.RunCommandService";
    private static final String ACTION_RUN_COMMAND = "com.termux.RUN_COMMAND";
    private static final String EXTRA_COMMAND_PATH = "com.termux.RUN_COMMAND_PATH";
    private static final String EXTRA_ARGUMENTS = "com.termux.RUN_COMMAND_ARGUMENTS";
    private static final String EXTRA_WORKDIR = "com.termux.RUN_COMMAND_WORKDIR";
    private static final String EXTRA_BACKGROUND = "com.termux.RUN_COMMAND_BACKGROUND";

    @PluginMethod
    public void startNova(PluginCall call) {
        if (getPermissionState("runCommand") != PermissionState.GRANTED) {
            requestPermissionForAlias(
                "runCommand",
                call,
                "runCommandPermissionCallback"
            );
            return;
        }
        launchNova(call);
    }

    @PermissionCallback
    private void runCommandPermissionCallback(PluginCall call) {
        if (getPermissionState("runCommand") != PermissionState.GRANTED) {
            call.reject("Run commands in Termux permission was not granted.");
            return;
        }
        launchNova(call);
    }

    private void launchNova(PluginCall call) {
        Intent intent = new Intent();
        intent.setClassName(TERMUX_PACKAGE, RUN_COMMAND_SERVICE);
        intent.setAction(ACTION_RUN_COMMAND);
        intent.putExtra(
            EXTRA_COMMAND_PATH,
            "/data/data/com.termux/files/usr/bin/bash"
        );
        intent.putExtra(
            EXTRA_ARGUMENTS,
            new String[] {
                "/data/data/com.termux/files/home/nova/termux/start_nova.sh"
            }
        );
        intent.putExtra(
            EXTRA_WORKDIR,
            "/data/data/com.termux/files/home"
        );
        intent.putExtra(EXTRA_BACKGROUND, true);

        try {
            ComponentName component = getContext().startService(intent);
            if (component == null) {
                call.reject("Termux RUN_COMMAND service is unavailable.");
                return;
            }
            JSObject result = new JSObject();
            result.put("started", true);
            call.resolve(result);
        } catch (SecurityException error) {
            call.reject(
                "Grant K3 Nova the Android Run commands in Termux permission.",
                error
            );
        } catch (Exception error) {
            call.reject("Unable to start Nova in Termux.", error);
        }
    }
}
`;

const activitySource = `package com.novatron.k3nova;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        registerPlugin(TermuxBridgePlugin.class);
    }
}
`;

writeFileSync(
  resolve(javaRoot, "TermuxBridgePlugin.java"),
  pluginSource,
  "utf8",
);
writeFileSync(
  resolve(javaRoot, "MainActivity.java"),
  activitySource,
  "utf8",
);

let manifest = readFileSync(manifestPath, "utf8");

if (!manifest.includes("com.termux.permission.RUN_COMMAND")) {
  manifest = manifest.replace(
    /<application\b/,
    `<uses-permission android:name="com.termux.permission.RUN_COMMAND" />
    <queries>
        <package android:name="com.termux" />
    </queries>

    <application`,
  );
}

if (!manifest.includes("android:networkSecurityConfig=")) {
  manifest = manifest.replace(
    /<application\b/,
    `<application android:networkSecurityConfig="@xml/network_security_config"`,
  );
}

writeFileSync(manifestPath, manifest, "utf8");

writeFileSync(
  resolve(xmlRoot, "network_security_config.xml"),
  `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">127.0.0.1</domain>
        <domain includeSubdomains="false">localhost</domain>
    </domain-config>
</network-security-config>
`,
  "utf8",
);

const isWindows = process.platform === "win32";
const npxCommand = isWindows ? "npx.cmd" : "npx";
const sync = spawnSync(npxCommand, ["cap", "sync", "android"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
  shell: isWindows,
});
if (sync.error !== undefined) {
  throw sync.error;
}
if (sync.status !== 0) {
  process.exit(sync.status ?? 1);
}
