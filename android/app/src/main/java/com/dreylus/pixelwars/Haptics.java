package com.dreylus.pixelwars;

import android.content.Context;
import android.media.AudioAttributes;
import android.os.Build;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

/**
 * Game haptics. On Pixel phones (Android 12+) every effect is built from
 * VibrationEffect composition primitives, which the Pixel actuator renders as
 * crisp clicks, thuds, spins and rises. Older devices fall back to predefined
 * effects or amplitude waveforms.
 */
final class Haptics {
    private final Vibrator vibrator;
    private final boolean rich;
    private final boolean amplitude;

    Haptics(Context context) {
        Vibrator v;
        if (Build.VERSION.SDK_INT >= 31) {
            VibratorManager vm = (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            v = vm != null ? vm.getDefaultVibrator() : null;
        } else {
            v = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
        }
        vibrator = v;
        amplitude = v != null && v.hasAmplitudeControl();
        boolean r = false;
        if (Build.VERSION.SDK_INT >= 31 && v != null) {
            r = v.areAllPrimitivesSupported(
                    VibrationEffect.Composition.PRIMITIVE_CLICK,
                    VibrationEffect.Composition.PRIMITIVE_TICK,
                    VibrationEffect.Composition.PRIMITIVE_LOW_TICK,
                    VibrationEffect.Composition.PRIMITIVE_THUD,
                    VibrationEffect.Composition.PRIMITIVE_SPIN,
                    VibrationEffect.Composition.PRIMITIVE_QUICK_RISE,
                    VibrationEffect.Composition.PRIMITIVE_SLOW_RISE,
                    VibrationEffect.Composition.PRIMITIVE_QUICK_FALL);
        }
        rich = r;
    }

    boolean isRich() {
        return rich;
    }

    void play(String name, float strength) {
        if (vibrator == null || !vibrator.hasVibrator() || name == null) return;
        float s = Math.max(0.05f, Math.min(1f, strength));
        VibrationEffect effect;
        try {
            effect = rich ? composed(name, s) : fallback(name, s);
        } catch (RuntimeException e) {
            effect = fallback(name, s);
        }
        if (effect == null) return;
        boolean ui = name.equals("tap") || name.equals("select") || name.equals("toggle") || name.equals("tick");
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                vibrator.vibrate(effect, VibrationAttributes.createForUsage(
                        ui ? VibrationAttributes.USAGE_TOUCH : VibrationAttributes.USAGE_MEDIA));
            } else {
                vibrator.vibrate(effect, new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_GAME)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
            }
        } catch (RuntimeException ignored) {
            // A haptic must never crash the game.
        }
    }

    private static float c(float v) {
        return Math.max(0f, Math.min(1f, v));
    }

    private VibrationEffect composed(String name, float s) {
        if (Build.VERSION.SDK_INT < 31) return null;
        final int CLICK = VibrationEffect.Composition.PRIMITIVE_CLICK;
        final int TICK = VibrationEffect.Composition.PRIMITIVE_TICK;
        final int LOW_TICK = VibrationEffect.Composition.PRIMITIVE_LOW_TICK;
        final int THUD = VibrationEffect.Composition.PRIMITIVE_THUD;
        final int SPIN = VibrationEffect.Composition.PRIMITIVE_SPIN;
        final int QUICK_RISE = VibrationEffect.Composition.PRIMITIVE_QUICK_RISE;
        final int SLOW_RISE = VibrationEffect.Composition.PRIMITIVE_SLOW_RISE;
        final int QUICK_FALL = VibrationEffect.Composition.PRIMITIVE_QUICK_FALL;
        VibrationEffect.Composition k = VibrationEffect.startComposition();
        switch (name) {
            case "tap":
                k.addPrimitive(TICK, c(0.55f * s));
                break;
            case "select":
                k.addPrimitive(CLICK, c(0.45f * s));
                break;
            case "toggle":
                k.addPrimitive(CLICK, c(0.7f * s));
                break;
            case "tick":
            case "paint":
            case "clash":
                k.addPrimitive(TICK, c(0.35f * s));
                break;
            case "pulse":
                k.addPrimitive(LOW_TICK, c(0.7f * s));
                break;
            case "start":
                k.addPrimitive(QUICK_RISE, c(0.6f * s)).addPrimitive(CLICK, c(s), 40);
                break;
            case "pause":
                k.addPrimitive(QUICK_FALL, c(0.55f * s));
                break;
            case "resume":
                k.addPrimitive(QUICK_RISE, c(0.45f * s));
                break;
            case "capture":
                k.addPrimitive(THUD, c(0.55f * s));
                break;
            case "bigCapture":
                k.addPrimitive(SLOW_RISE, c(0.5f * s))
                        .addPrimitive(THUD, c(s), 30)
                        .addPrimitive(CLICK, c(0.8f * s), 60);
                break;
            case "elim":
                k.addPrimitive(SPIN, c(0.8f * s)).addPrimitive(THUD, c(s), 80);
                break;
            case "victory":
                k.addPrimitive(QUICK_RISE, c(0.7f * s))
                        .addPrimitive(CLICK, c(s), 60)
                        .addPrimitive(CLICK, c(0.8f * s), 90)
                        .addPrimitive(SPIN, c(s), 120)
                        .addPrimitive(THUD, c(s), 160);
                break;
            case "defeat":
                k.addPrimitive(SLOW_RISE, c(0.4f * s))
                        .addPrimitive(QUICK_FALL, c(0.8f * s), 40)
                        .addPrimitive(THUD, c(0.6f * s), 80);
                break;
            case "bolt":
                k.addPrimitive(CLICK, c(0.9f * s)).addPrimitive(TICK, c(0.6f * s), 20);
                break;
            case "meteor":
                k.addPrimitive(THUD, c(s))
                        .addPrimitive(THUD, c(0.8f * s), 70)
                        .addPrimitive(LOW_TICK, c(0.7f * s), 60);
                break;
            case "spawn":
                k.addPrimitive(QUICK_RISE, c(0.5f * s)).addPrimitive(CLICK, c(0.6f * s), 10);
                break;
            case "error":
                k.addPrimitive(CLICK, c(0.6f * s)).addPrimitive(CLICK, c(0.6f * s), 70);
                break;
            case "success":
                k.addPrimitive(TICK, c(0.6f * s)).addPrimitive(CLICK, c(0.9f * s), 50);
                break;
            case "countdown":
                k.addPrimitive(CLICK, c(0.7f * s));
                break;
            case "go":
                k.addPrimitive(QUICK_RISE, c(0.8f * s)).addPrimitive(THUD, c(s), 20);
                break;
            default:
                k.addPrimitive(TICK, c(0.5f * s));
                break;
        }
        return k.compose();
    }

    private int amp(float v) {
        return Math.max(1, Math.min(255, Math.round(255 * v)));
    }

    private VibrationEffect wave(long[] timings, float[] levels, float s) {
        if (!amplitude) {
            long total = 0;
            for (int i = 0; i < timings.length; i++) if (levels[i] > 0) total += timings[i];
            return VibrationEffect.createOneShot(Math.max(5, total), VibrationEffect.DEFAULT_AMPLITUDE);
        }
        int[] a = new int[levels.length];
        for (int i = 0; i < levels.length; i++) a[i] = levels[i] <= 0 ? 0 : amp(levels[i] * s);
        return VibrationEffect.createWaveform(timings, a, -1);
    }

    private VibrationEffect predefined(int id) {
        if (Build.VERSION.SDK_INT >= 29) return VibrationEffect.createPredefined(id);
        return null;
    }

    private VibrationEffect fallback(String name, float s) {
        switch (name) {
            case "tap":
            case "tick":
            case "paint":
            case "clash":
            case "pulse": {
                VibrationEffect p = predefined(VibrationEffect.EFFECT_TICK);
                return p != null ? p : VibrationEffect.createOneShot(6, amplitude ? amp(0.4f * s) : VibrationEffect.DEFAULT_AMPLITUDE);
            }
            case "select":
            case "toggle":
            case "countdown":
            case "bolt":
            case "capture": {
                VibrationEffect p = predefined(VibrationEffect.EFFECT_CLICK);
                return p != null ? p : VibrationEffect.createOneShot(14, amplitude ? amp(0.7f * s) : VibrationEffect.DEFAULT_AMPLITUDE);
            }
            case "error":
            case "success": {
                VibrationEffect p = predefined(VibrationEffect.EFFECT_DOUBLE_CLICK);
                return p != null ? p : wave(new long[]{0, 15, 60, 15}, new float[]{0, 0.7f, 0, 0.7f}, s);
            }
            case "bigCapture":
                return wave(new long[]{0, 40, 30, 70}, new float[]{0, 0.5f, 0, 1f}, s);
            case "elim":
                return wave(new long[]{0, 30, 40, 30, 40, 60}, new float[]{0, 0.6f, 0, 0.7f, 0, 1f}, s);
            case "victory":
                return wave(new long[]{0, 30, 60, 30, 60, 120}, new float[]{0, 0.6f, 0, 0.8f, 0, 1f}, s);
            case "defeat":
                return wave(new long[]{0, 80, 80, 140}, new float[]{0, 0.5f, 0, 0.8f}, s);
            case "meteor":
                return wave(new long[]{0, 90, 40, 60}, new float[]{0, 1f, 0, 0.6f}, s);
            case "start":
            case "go":
                return wave(new long[]{0, 25, 25, 50}, new float[]{0, 0.5f, 0, 1f}, s);
            default: {
                VibrationEffect p = predefined(VibrationEffect.EFFECT_HEAVY_CLICK);
                return p != null ? p : VibrationEffect.createOneShot(20, amplitude ? amp(0.8f * s) : VibrationEffect.DEFAULT_AMPLITUDE);
            }
        }
    }
}
