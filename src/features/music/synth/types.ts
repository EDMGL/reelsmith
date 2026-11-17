/** Shared data types of the synthesis toolkit (all JSON-like, deterministic). */

/** One scheduled note/hit. Times in seconds from the loop start. */
export interface NoteEvent {
  t: number;
  /** Gate length, seconds. */
  d: number;
  /** Instrument id (key of `Arrangement.instruments`). */
  inst: string;
  /** MIDI note (drums: ignored / variant). */
  n: number;
  /** Velocity 0..1. */
  v: number;
}

export type VoiceKind =
  | 'kick'
  | 'snare'
  | 'clap'
  | 'hat'
  | 'openhat'
  | 'shaker'
  | 'rim'
  | 'tom'
  | 'crash'
  | 'bass'
  | 'sub'
  | 'pad'
  | 'strings'
  | 'piano'
  | 'epiano'
  | 'pluck'
  | 'guitar'
  | 'mallet'
  | 'bell'
  | 'synthpluck'
  | 'lead'
  | 'brass'
  | 'boom'
  | 'riser'
  | 'vinyl';

export interface VoiceParams {
  wave?: OscillatorType;
  /** Filter cutoff, Hz. */
  cutoff?: number;
  /** Filter Q. */
  reso?: number;
  /** Filter envelope amount (multiplier of cutoff at the peak). */
  env?: number;
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
  /** Detune spread between unison voices, cents. */
  detune?: number;
  /** 0..1 brightness/tone control. */
  tone?: number;
  /** Drum base pitch, Hz. */
  pitch?: number;
  /** Vibrato depth, cents. */
  vibrato?: number;
}

export interface InstrumentSpec {
  voice: VoiceKind;
  /** Level, dB. */
  gain: number;
  pan?: number;
  /** Reverb send 0..1. */
  reverb?: number;
  /** Delay send 0..1. */
  delay?: number;
  /** Sidechain duck depth 0..1 (driven by `Arrangement.duck.source` hits). */
  duck?: number;
  params?: VoiceParams;
}

export interface Arrangement {
  bpm: number;
  beatsPerBar: number;
  bars: number;
  /** Exact loop length, seconds (bars * beatsPerBar * 60 / bpm). */
  loopSeconds: number;
  events: NoteEvent[];
  instruments: Record<string, InstrumentSpec>;
  reverb: { seconds: number; brightness: number; preDelay: number; level: number };
  delay?: { beats: number; feedback: number; tone: number; level: number };
  duck?: { source: string; release: number };
}
