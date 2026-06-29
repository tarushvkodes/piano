import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Midi } from '@tonejs/midi';
import { Accidental, Formatter, Renderer, Stave, StaveConnector, StaveNote, Voice } from 'vexflow';
import {
  Bluetooth,
  CircleStop,
  ExternalLink,
  FileMusic,
  Hand,
  KeyboardMusic,
  Pause,
  Play,
  RefreshCw,
  SkipBack,
  StepBack,
  StepForward,
  Upload,
} from 'lucide-react';
import './styles.css';

const FIRST_NOTE = 21;
const LAST_NOTE = 108;
const LOOKAHEAD_SECONDS = 4;
const CHORD_WINDOW_SECONDS = 0.08;
const MAGIC_STRINGS_LOCAL_PATH = '/midi/mrs-magic-strings-version.mid';
const STRESS_RELIEF_LOCAL_PATH = '/midi/stress-relief-late-night-drive-home.mid';
const MAGIC_STRINGS_SOURCE_URL = 'https://www.hamienet.com/midi95020_Mrs-Magic-Strings-Version.html';
const STRESS_RELIEF_SOURCE_URL = 'https://www.youtube.com/watch?v=mcsndWw-Tzs';
const SONG_PRESETS = [
  {
    id: 'mrs-magic',
    label: 'Mrs Magic',
    fileName: 'Mrs Magic (Strings Version).mid',
    localPath: MAGIC_STRINGS_LOCAL_PATH,
    sourceUrl: MAGIC_STRINGS_SOURCE_URL,
  },
  {
    id: 'stress-relief',
    label: 'Stress Relief',
    fileName: 'Stress Relief - Late Night Drive Home.mid',
    localPath: STRESS_RELIEF_LOCAL_PATH,
    sourceUrl: STRESS_RELIEF_SOURCE_URL,
  },
];
const WHITE_PITCHES = new Set([0, 2, 4, 5, 7, 9, 11]);
const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const VEX_NOTE_NAMES = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];
const FLAT_PITCHES = new Set([1, 3, 6, 8, 10]);

function noteName(midi) {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function noteColor(midi) {
  const hue = ((midi - FIRST_NOTE) * 17) % 360;
  return `hsl(${hue} 68% 50%)`;
}

function midiToVexKey(midi) {
  const pitch = midi % 12;
  const rawName = VEX_NOTE_NAMES[pitch];
  return {
    key: `${rawName}/${Math.floor(midi / 12) - 1}`,
    accidental: FLAT_PITCHES.has(pitch) ? 'b' : null,
  };
}

function formatNotes(midis) {
  return [...midis].sort((a, b) => a - b).map(noteName).join(' ');
}

function formatHandParts(midis) {
  const left = [...midis].filter((midi) => midi < 60);
  const right = [...midis].filter((midi) => midi >= 60);
  return {
    left: left.length ? formatNotes(left) : '',
    right: right.length ? formatNotes(right) : '',
  };
}

function isMidiBuffer(buffer) {
  if (!buffer || buffer.byteLength < 14) return false;
  const header = new TextDecoder('ascii').decode(new Uint8Array(buffer, 0, 4));
  return header === 'MThd';
}

function normalizeMidi(raw) {
  const notes = [];
  raw.tracks.forEach((track, trackIndex) => {
    track.notes.forEach((note) => {
      if (note.midi >= FIRST_NOTE && note.midi <= LAST_NOTE) {
        notes.push({
          id: `${trackIndex}-${note.ticks}-${note.midi}-${notes.length}`,
          midi: note.midi,
          name: note.name,
          start: note.time,
          duration: Math.max(0.08, note.duration),
          end: note.time + Math.max(0.08, note.duration),
          velocity: note.velocity,
          trackName: track.name || `Track ${trackIndex + 1}`,
        });
      }
    });
  });

  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  return {
    name: raw.name || 'Untitled MIDI',
    duration: Math.max(raw.duration, ...notes.map((note) => note.end), 0),
    bpm: raw.header.tempos[0]?.bpm ? Math.round(raw.header.tempos[0].bpm) : null,
    notes,
  };
}

function buildKeyboard() {
  const keys = [];
  let whiteIndex = 0;
  for (let midi = FIRST_NOTE; midi <= LAST_NOTE; midi += 1) {
    const pitch = midi % 12;
    const isWhite = WHITE_PITCHES.has(pitch);
    const key = { midi, pitch, name: noteName(midi), isWhite, whiteIndex };
    if (isWhite) {
      key.left = whiteIndex;
      whiteIndex += 1;
    } else {
      key.left = whiteIndex - 0.36;
    }
    keys.push(key);
  }
  return { keys, whiteCount: whiteIndex };
}

function buildPracticeSteps(notes) {
  const steps = [];
  notes.forEach((note) => {
    const previous = steps[steps.length - 1];
    if (previous && Math.abs(note.start - previous.start) <= CHORD_WINDOW_SECONDS) {
      previous.notes.push(note);
      previous.midis.add(note.midi);
      previous.noteIds.push(note.id);
      previous.end = Math.max(previous.end, note.end);
      return;
    }

    steps.push({
      start: note.start,
      end: note.end,
      midis: new Set([note.midi]),
      noteIds: [note.id],
      notes: [note],
    });
  });

  return steps.map((step, index) => ({
    ...step,
    index,
    label: formatNotes(step.midis),
  }));
}

function makeVexNote(midis, clef) {
  const fallbackKey = clef === 'treble' ? 'b/4' : 'd/3';
  const noteMidis = [...midis].sort((a, b) => a - b);
  const keys = noteMidis.length ? noteMidis.map((midi) => midiToVexKey(midi).key) : [fallbackKey];
  const staveNote = new StaveNote({
    clef,
    keys,
    duration: noteMidis.length ? 'q' : 'qr',
  });

  noteMidis.forEach((midi, index) => {
    const vex = midiToVexKey(midi);
    if (vex.accidental) staveNote.addModifier(new Accidental(vex.accidental), index);
  });

  return staveNote;
}

function drawSheet(container, step) {
  container.innerHTML = '';
  const width = Math.max(560, container.clientWidth || 760);
  const renderer = new Renderer(container, Renderer.Backends.SVG);
  renderer.resize(width, 136);
  const context = renderer.getContext();
  context.setFont('Arial', 10);

  const treble = new Stave(18, 2, width - 40);
  const bass = new Stave(18, 62, width - 40);
  treble.addClef('treble');
  bass.addClef('bass');
  treble.setContext(context).draw();
  bass.setContext(context).draw();

  const brace = new StaveConnector(treble, bass);
  brace.setType(StaveConnector.type.BRACE);
  brace.setContext(context).draw();
  const line = new StaveConnector(treble, bass);
  line.setType(StaveConnector.type.SINGLE_LEFT);
  line.setContext(context).draw();

  const targetMidis = step ? [...step.midis] : [];
  const trebleMidis = targetMidis.filter((midi) => midi >= 60);
  const bassMidis = targetMidis.filter((midi) => midi < 60);

  const trebleNotes = [makeVexNote(trebleMidis, 'treble')];
  const bassNotes = [makeVexNote(bassMidis, 'bass')];
  const trebleVoice = new Voice({ num_beats: 1, beat_value: 4 }).setStrict(false);
  const bassVoice = new Voice({ num_beats: 1, beat_value: 4 }).setStrict(false);
  trebleVoice.addTickables(trebleNotes);
  bassVoice.addTickables(bassNotes);

  new Formatter().joinVoices([trebleVoice]).format([trebleVoice], width - 120);
  new Formatter().joinVoices([bassVoice]).format([bassVoice], width - 120);
  trebleVoice.draw(context, treble);
  bassVoice.draw(context, bass);
}

function SheetPreview({ step, nextStep, played }) {
  const sheetRef = useRef(null);

  useEffect(() => {
    const container = sheetRef.current;
    if (!container) return undefined;

    const render = () => drawSheet(container, step);
    render();
    const observer = new ResizeObserver(render);
    observer.observe(container);
    return () => observer.disconnect();
  }, [step]);

  const currentLabel = step?.label || 'Load a MIDI file';
  const playedLabel = played.size ? formatNotes(played) : 'None yet';
  const nextLabel = nextStep?.label || 'End';
  const handParts = step ? formatHandParts(step.midis) : { left: '', right: '' };
  const handLabel = [handParts.left && `L ${handParts.left}`, handParts.right && `R ${handParts.right}`].filter(Boolean).join(' | ') || 'Ready';

  return (
    <div className="sheetPanel">
      <div className="sheetHeader">
        <div>
          <span>Sheet link</span>
          <strong>{currentLabel}</strong>
        </div>
        <div>
          <span>Played</span>
          <strong>{playedLabel}</strong>
        </div>
        <div>
          <span>Next</span>
          <strong>{nextLabel}</strong>
        </div>
        <div>
          <span>Hands</span>
          <strong>{handLabel}</strong>
        </div>
      </div>
      <div className="sheetCanvas" ref={sheetRef} />
    </div>
  );
}

function useAnimationFrame(active, callback) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!active) return undefined;
    let frame = 0;
    const tick = () => {
      callbackRef.current(performance.now());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active]);
}

function App() {
  const [midiAccess, setMidiAccess] = useState(null);
  const [midiError, setMidiError] = useState('');
  const [inputs, setInputs] = useState([]);
  const [selectedInputId, setSelectedInputId] = useState('');
  const [song, setSong] = useState(null);
  const [fileError, setFileError] = useState('');
  const [songUrl, setSongUrl] = useState('');
  const [pressed, setPressed] = useState(() => new Map());
  const [hitNotes, setHitNotes] = useState(() => new Set());
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(0.8);
  const [practiceMode, setPracticeMode] = useState('coach');
  const [restartOnMistake, setRestartOnMistake] = useState(true);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [showKeyLabels, setShowKeyLabels] = useState(true);
  const [coachStepIndex, setCoachStepIndex] = useState(0);
  const [coachPlayed, setCoachPlayed] = useState(() => new Set());
  const [mistakeCount, setMistakeCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [coachMessage, setCoachMessage] = useState('Load a MIDI file, then play the highlighted keys.');
  const startRef = useRef({ wallTime: 0, songTime: 0 });
  const coachTimerRef = useRef(0);
  const fileInputRef = useRef(null);
  const { keys, whiteCount } = useMemo(buildKeyboard, []);

  const practiceSteps = useMemo(() => buildPracticeSteps(song?.notes || []), [song]);
  const currentPracticeStep = practiceMode === 'coach' ? practiceSteps[coachStepIndex] : null;
  const nextPracticeStep = practiceSteps[coachStepIndex + 1] || null;
  const handParts = currentPracticeStep ? formatHandParts(currentPracticeStep.midis) : { left: '', right: '' };
  const handGuide = [handParts.left && `Left hand: ${handParts.left}`, handParts.right && `Right hand: ${handParts.right}`].filter(Boolean).join(' | ');

  const resetToBeginning = useCallback((message = 'Back to the beginning. Try the first target again.') => {
    window.clearTimeout(coachTimerRef.current);
    setPlaying(false);
    setCurrentTime(0);
    setCoachStepIndex(0);
    setCoachPlayed(new Set());
    setHitNotes(new Set());
    setStreak(0);
    setMistakeCount((count) => count + 1);
    setCoachMessage(message);
    startRef.current = { wallTime: performance.now(), songTime: 0 };
  }, []);

  const advanceCoachStep = useCallback((completedStep) => {
    if (!completedStep) return;
    setHitNotes((previous) => {
      const next = new Set(previous);
      completedStep.noteIds.forEach((id) => next.add(id));
      return next;
    });
    setStreak((value) => value + 1);
    setCoachPlayed(new Set());

    const nextIndex = completedStep.index + 1;
    if (!autoAdvance) {
      setCoachMessage(`Correct: ${completedStep.label}. Press next target when you are ready.`);
      return;
    }

    if (nextIndex >= practiceSteps.length) {
      setPlaying(false);
      setCurrentTime(song?.duration || completedStep.end);
      setCoachMessage('Song complete. Rewind to run it again.');
      return;
    }

    setCoachStepIndex(nextIndex);
    setCurrentTime(practiceSteps[nextIndex].start);
    setCoachMessage(`Good. Next: ${practiceSteps[nextIndex].label}`);
  }, [autoAdvance, practiceSteps, song]);

  const refreshInputs = useCallback((access = midiAccess) => {
    if (!access) return;
    const nextInputs = Array.from(access.inputs.values()).map((input) => ({
      id: input.id,
      name: input.name || 'Unnamed MIDI Input',
      manufacturer: input.manufacturer || '',
      state: input.state,
      connection: input.connection,
    }));
    setInputs(nextInputs);
    setSelectedInputId((existing) => {
      if (existing && nextInputs.some((input) => input.id === existing)) return existing;
      const roland = nextInputs.find((input) => /roland|fp-?10|digital piano/i.test(`${input.name} ${input.manufacturer}`));
      return roland?.id || nextInputs[0]?.id || '';
    });
  }, [midiAccess]);

  const connectMidi = useCallback(async () => {
    setMidiError('');
    if (!navigator.requestMIDIAccess) {
      setMidiError('This browser does not expose Web MIDI. Use Chrome or Edge, then pair the FP-10 in macOS Audio MIDI Setup.');
      return;
    }
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      setMidiAccess(access);
      refreshInputs(access);
      access.onstatechange = () => refreshInputs(access);
    } catch (error) {
      setMidiError(error?.message || 'Could not open MIDI access.');
    }
  }, [refreshInputs]);

  useAnimationFrame(playing && practiceMode !== 'coach', (now) => {
    const elapsed = ((now - startRef.current.wallTime) / 1000) * playbackRate;
    const nextTime = clamp(startRef.current.songTime + elapsed, 0, song?.duration || 0);
    setCurrentTime(nextTime);
    if (song && nextTime >= song.duration) {
      setPlaying(false);
    }
  });

  const loadMidiBuffer = async (buffer, fileName) => {
    setFileError('');
    if (!isMidiBuffer(buffer)) {
      setFileError(`${fileName} is missing or is not a MIDI file. Put the real .mid file in public/midi/ or use Load MIDI.`);
      return;
    }
    try {
      const parsed = normalizeMidi(new Midi(buffer));
      if (!parsed.notes.length) {
        setFileError('That MIDI file did not contain any playable 88-key piano notes.');
        return;
      }
      setSong({ ...parsed, fileName });
      setCurrentTime(0);
      setHitNotes(new Set());
      setCoachStepIndex(0);
      setCoachPlayed(new Set());
      setMistakeCount(0);
      setStreak(0);
      setCoachMessage('Ready. Play the highlighted target; a wrong note restarts the song.');
      setPlaying(false);
    } catch (error) {
      setFileError(error?.message || 'Could not parse that MIDI file.');
    }
  };

  const loadMidiFile = async (file) => {
    if (!file) return;
    await loadMidiBuffer(await file.arrayBuffer(), file.name);
  };

  const loadMidiUrl = async (url, label = url.split('/').pop() || 'remote.mid') => {
    setFileError('');
    try {
      const response = await fetch(url);
      if (response.status === 404) throw new Error(`${label} is not in public/midi yet.`);
      if (!response.ok) throw new Error(`Could not fetch MIDI (${response.status}).`);
      await loadMidiBuffer(await response.arrayBuffer(), label);
    } catch (error) {
      setFileError(`${error?.message || 'Could not load MIDI URL.'} Download the MIDI and use Load MIDI if the source blocks browser fetches.`);
    }
  };

  const loadPresetSong = async (preset) => {
    await loadMidiUrl(preset.localPath, preset.fileName);
  };

  const togglePlayback = () => {
    if (!song) return;
    if (practiceMode === 'coach') {
      setPlaying((value) => !value);
      setCoachMessage(currentPracticeStep ? `Play: ${currentPracticeStep.label}` : 'Ready.');
      return;
    }
    if (playing) {
      setPlaying(false);
      return;
    }
    startRef.current = { wallTime: performance.now(), songTime: currentTime };
    setPlaying(true);
  };

  const rewind = () => {
    setCurrentTime(0);
    setCoachStepIndex(0);
    setCoachPlayed(new Set());
    startRef.current = { wallTime: performance.now(), songTime: 0 };
    setHitNotes(new Set());
    setStreak(0);
    setCoachMessage('Rewound. Start from the first target.');
  };

  const goToCoachStep = (index) => {
    if (!practiceSteps.length) return;
    const nextIndex = clamp(index, 0, practiceSteps.length - 1);
    const step = practiceSteps[nextIndex];
    window.clearTimeout(coachTimerRef.current);
    setPlaying(false);
    setCurrentTime(step.start);
    setCoachStepIndex(nextIndex);
    setCoachPlayed(new Set());
    setCoachMessage(`Target ${nextIndex + 1}: ${step.label}`);
  };

  const stop = () => {
    setPlaying(false);
    setCurrentTime(0);
    setCoachStepIndex(0);
    setCoachPlayed(new Set());
    setHitNotes(new Set());
    setStreak(0);
    setCoachMessage('Stopped at the beginning.');
  };

  useEffect(() => {
    if (practiceMode === 'coach') {
      setPlaying(false);
      setCurrentTime(practiceSteps[coachStepIndex]?.start || 0);
      setCoachPlayed(new Set());
      setCoachMessage(practiceSteps[coachStepIndex] ? `Play: ${practiceSteps[coachStepIndex].label}` : 'Load a MIDI file, then play the highlighted keys.');
    }
  }, [coachStepIndex, practiceMode, practiceSteps]);

  const visibleNotes = useMemo(() => {
    if (!song) return [];
    return song.notes.filter((note) => note.end >= currentTime - 0.3 && note.start <= currentTime + LOOKAHEAD_SECONDS);
  }, [currentTime, song]);

  const currentTargets = useMemo(() => {
    if (currentPracticeStep) return new Set(currentPracticeStep.midis);
    const active = new Set();
    visibleNotes.forEach((note) => {
      if (note.start <= currentTime + 0.12 && note.end >= currentTime - 0.05) active.add(note.midi);
    });
    return active;
  }, [currentPracticeStep, currentTime, visibleNotes]);

  const upcomingTargets = useMemo(() => {
    const upcoming = new Set();
    if (practiceMode === 'coach') {
      practiceSteps.slice(coachStepIndex + 1, coachStepIndex + 5).forEach((step) => {
        step.midis.forEach((midi) => upcoming.add(midi));
      });
      return upcoming;
    }
    visibleNotes.forEach((note) => {
      if (note.start > currentTime && note.start <= currentTime + 1.2) upcoming.add(note.midi);
    });
    return upcoming;
  }, [coachStepIndex, currentTime, practiceMode, practiceSteps, visibleNotes]);

  useEffect(() => {
    if (!midiAccess) return undefined;
    const input = midiAccess.inputs.get(selectedInputId);
    if (!input) return undefined;

    input.onmidimessage = (message) => {
      const [status, note, velocity] = message.data;
      const command = status & 0xf0;
      if (note < FIRST_NOTE || note > LAST_NOTE) return;

      if (command === 0x90 && velocity > 0) {
        setPressed((previous) => {
          const next = new Map(previous);
          next.set(note, velocity);
          return next;
        });

        if (song && practiceMode === 'coach') {
          const step = currentPracticeStep;
          if (!step) return;

          if (!step.midis.has(note)) {
            if (restartOnMistake) {
              resetToBeginning(`Wrong note: ${noteName(note)}. Expected ${step.label}. Restarting from the beginning.`);
            } else {
              setMistakeCount((count) => count + 1);
              setStreak(0);
              setCoachMessage(`Wrong note: ${noteName(note)}. Expected ${step.label}.`);
            }
            return;
          }

          setCoachPlayed((previous) => {
            const next = new Set(previous);
            next.add(note);
            const complete = [...step.midis].every((midi) => next.has(midi));
            if (complete) {
              window.clearTimeout(coachTimerRef.current);
              coachTimerRef.current = window.setTimeout(() => advanceCoachStep(step), 140);
            } else {
              const remaining = [...step.midis].filter((midi) => !next.has(midi));
              setCoachMessage(`Hold that. Add ${formatNotes(remaining)}.`);
            }
            return next;
          });
          return;
        }

        if (song && restartOnMistake && playing && currentTargets.size > 0 && !currentTargets.has(note)) {
          resetToBeginning(`Wrong note: ${noteName(note)}. Restarting from the beginning.`);
          return;
        }

        setHitNotes((previous) => {
          const next = new Set(previous);
          const tolerance = 0.45;
          song?.notes.forEach((target) => {
            if (target.midi === note && Math.abs(target.start - currentTime) <= tolerance) {
              next.add(target.id);
            }
          });
          return next;
        });
      }

      if (command === 0x80 || (command === 0x90 && velocity === 0)) {
        setPressed((previous) => {
          const next = new Map(previous);
          next.delete(note);
          return next;
        });
      }
    };

    return () => {
      input.onmidimessage = null;
    };
  }, [
    advanceCoachStep,
    currentPracticeStep,
    currentTargets,
    currentTime,
    midiAccess,
    playing,
    practiceMode,
    resetToBeginning,
    restartOnMistake,
    selectedInputId,
    song,
  ]);

  const pressedSet = useMemo(() => new Set(pressed.keys()), [pressed]);
  const correctPressed = [...pressedSet].filter((midi) => currentTargets.has(midi)).length;
  const accuracy = song ? Math.round((hitNotes.size / song.notes.length) * 100) : 0;
  const stepProgress = practiceSteps.length ? `${Math.min(coachStepIndex + 1, practiceSteps.length)} / ${practiceSteps.length}` : '0 / 0';

  return (
    <main className="app">
      <section className="topbar">
        <div>
          <p className="eyebrow">Roland FP-10 Bluetooth MIDI trainer</p>
          <h1>Practice with a live keyboard overlay</h1>
        </div>
        <button className="primary" onClick={connectMidi}>
          <Bluetooth size={18} />
          Connect MIDI
        </button>
      </section>

      <section className="workspace">
        <aside className="panel controls">
          <div className="controlGroup">
            <div className="sectionTitle">
              <KeyboardMusic size={18} />
              FP-10 Input
            </div>
            <select value={selectedInputId} onChange={(event) => setSelectedInputId(event.target.value)}>
              <option value="">No MIDI input selected</option>
              {inputs.map((input) => (
                <option key={input.id} value={input.id}>
                  {input.name} {input.manufacturer ? `(${input.manufacturer})` : ''}
                </option>
              ))}
            </select>
            <button className="secondary" onClick={() => refreshInputs()}>
              <RefreshCw size={16} />
              Refresh
            </button>
            {midiError && <p className="error">{midiError}</p>}
            {!midiAccess && <p className="hint">Pair the FP-10 in Audio MIDI Setup, then connect here in Chrome or Edge.</p>}
          </div>

          <div className="controlGroup">
            <div className="sectionTitle">
              <FileMusic size={18} />
              Song
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".mid,.midi,audio/midi"
              onChange={(event) => loadMidiFile(event.target.files?.[0])}
            />
            <button className="secondary" onClick={() => fileInputRef.current?.click()}>
              <Upload size={16} />
              Load MIDI
            </button>
            <div className="presetSongs">
              {SONG_PRESETS.map((preset) => (
                <button key={preset.id} className="secondary" onClick={() => loadPresetSong(preset)}>
                  <FileMusic size={16} />
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="urlLoad">
              <input
                type="url"
                value={songUrl}
                onChange={(event) => setSongUrl(event.target.value)}
                placeholder="Paste direct .mid URL"
              />
              <button className="secondary iconButton" onClick={() => loadMidiUrl(songUrl)} disabled={!songUrl}>
                <Upload size={16} />
              </button>
            </div>
            <a className="sourceLink" href={MAGIC_STRINGS_SOURCE_URL} target="_blank" rel="noreferrer">
              <ExternalLink size={15} />
              Mrs Magic source
            </a>
            <a className="sourceLink" href={STRESS_RELIEF_SOURCE_URL} target="_blank" rel="noreferrer">
              <ExternalLink size={15} />
              Stress Relief tab video
            </a>
            {fileError && <p className="error">{fileError}</p>}
            {song && (
              <div className="songMeta">
                <strong>{song.fileName}</strong>
                <span>{song.notes.length.toLocaleString()} notes</span>
                <span>{song.bpm ? `${song.bpm} BPM` : 'Tempo from file'}</span>
              </div>
            )}
            <p className="hint">Leave the FP-10 on Concert Piano. The app only listens to your notes and never changes the instrument.</p>
          </div>

          <div className="controlGroup">
            <div className="sectionTitle">Practice</div>
            <div className="segmented">
              <button className={practiceMode === 'coach' ? 'active' : ''} onClick={() => setPracticeMode('coach')}>Coach</button>
              <button className={practiceMode === 'follow' ? 'active' : ''} onClick={() => setPracticeMode('follow')}>Follow</button>
            </div>
            <label className="toggleRow">
              <input
                type="checkbox"
                checked={restartOnMistake}
                onChange={(event) => setRestartOnMistake(event.target.checked)}
              />
              <span>Restart on mistake</span>
            </label>
            <label className="toggleRow">
              <input
                type="checkbox"
                checked={autoAdvance}
                onChange={(event) => setAutoAdvance(event.target.checked)}
              />
              <span>Auto-advance after correct notes</span>
            </label>
            <label className="toggleRow">
              <input
                type="checkbox"
                checked={showKeyLabels}
                onChange={(event) => setShowKeyLabels(event.target.checked)}
              />
              <span>Show beginner key labels</span>
            </label>
            <label>
              Speed
              <input
                type="range"
                min="0.25"
                max="1.25"
                step="0.05"
                value={playbackRate}
                onChange={(event) => setPlaybackRate(Number(event.target.value))}
              />
              <span>{Math.round(playbackRate * 100)}%</span>
            </label>
            <div className="transport">
              <button onClick={rewind} disabled={!song} title="Rewind">
                <SkipBack size={17} />
              </button>
              <button onClick={togglePlayback} disabled={!song} title={playing ? 'Pause' : 'Play'}>
                {playing ? <Pause size={18} /> : <Play size={18} />}
              </button>
              <button onClick={stop} disabled={!song} title="Stop">
                <CircleStop size={18} />
              </button>
            </div>
            <div className="stepTools">
              <button onClick={() => goToCoachStep(coachStepIndex - 1)} disabled={!song || practiceMode !== 'coach' || coachStepIndex <= 0} title="Previous target">
                <StepBack size={17} />
                Previous
              </button>
              <button onClick={() => goToCoachStep(coachStepIndex + 1)} disabled={!song || practiceMode !== 'coach' || coachStepIndex >= practiceSteps.length - 1} title="Next target">
                Next
                <StepForward size={17} />
              </button>
            </div>
          </div>
        </aside>

        <section className="stage">
          <SheetPreview step={currentPracticeStep} nextStep={nextPracticeStep} played={coachPlayed} />

          <div className="stats">
            <div>
              <span>{practiceMode === 'coach' ? 'Step' : 'Time'}</span>
              <strong>{practiceMode === 'coach' ? stepProgress : `${currentTime.toFixed(1)}s`}</strong>
            </div>
            <div>
              <span>Target</span>
              <strong>{[...currentTargets].map(noteName).join(' ') || 'Ready'}</strong>
            </div>
            <div>
              <span>Live</span>
              <strong>{[...pressedSet].map(noteName).join(' ') || 'Silent'}</strong>
            </div>
            <div>
              <span>{practiceMode === 'coach' ? 'Mistakes' : 'Hits'}</span>
              <strong>{practiceMode === 'coach' ? mistakeCount : `${accuracy}%`}</strong>
            </div>
          </div>

          <div className="roll" style={{ '--white-count': whiteCount }}>
            {practiceMode === 'coach' && (
              <div className="coachBanner">
                <strong>{coachMessage}</strong>
                {handGuide && (
                  <em>
                    <Hand size={14} />
                    {handGuide}
                  </em>
                )}
                <span>Streak {streak} · {restartOnMistake ? 'Wrong notes send you back to the beginning' : 'Wrong notes are counted only'}</span>
              </div>
            )}
            <div className="playLine" />
            {visibleNotes.map((note) => {
              const key = keys.find((candidate) => candidate.midi === note.midi);
              const width = key?.isWhite ? 0.86 : 0.55;
              const left = ((key?.left || 0) / whiteCount) * 100;
              const y = ((note.start - currentTime) / LOOKAHEAD_SECONDS) * 100;
              const height = Math.max((note.duration / LOOKAHEAD_SECONDS) * 100, 2.5);
              const hit = hitNotes.has(note.id);
              const isCoachTarget = currentPracticeStep?.noteIds.includes(note.id);
              return (
                <div
                  key={note.id}
                  className={`fallingNote ${hit ? 'hit' : ''} ${isCoachTarget ? 'targetNote' : ''}`}
                  style={{
                    left: `${left}%`,
                    width: `${(width / whiteCount) * 100}%`,
                    bottom: `${y}%`,
                    height: `${height}%`,
                    background: noteColor(note.midi),
                  }}
                  title={`${note.name} ${note.start.toFixed(2)}s`}
                />
              );
            })}
          </div>

          <div className="keyboard" style={{ '--white-count': whiteCount }}>
            {keys.filter((key) => key.isWhite).map((key) => (
              <button
                key={key.midi}
                className={[
                  'key white',
                  pressedSet.has(key.midi) ? 'pressed' : '',
                  currentTargets.has(key.midi) ? 'target' : '',
                  currentTargets.has(key.midi) && key.midi < 60 ? 'leftHand' : '',
                  currentTargets.has(key.midi) && key.midi >= 60 ? 'rightHand' : '',
                  coachPlayed.has(key.midi) ? 'partial' : '',
                  upcomingTargets.has(key.midi) ? 'upcoming' : '',
                ].join(' ')}
                style={{ '--accent': noteColor(key.midi) }}
                title={key.name}
              >
                <span>{showKeyLabels || currentTargets.has(key.midi) || key.pitch === 0 ? key.name : ''}</span>
              </button>
            ))}
            {keys.filter((key) => !key.isWhite).map((key) => (
              <button
                key={key.midi}
                className={[
                  'key black',
                  pressedSet.has(key.midi) ? 'pressed' : '',
                  currentTargets.has(key.midi) ? 'target' : '',
                  currentTargets.has(key.midi) && key.midi < 60 ? 'leftHand' : '',
                  currentTargets.has(key.midi) && key.midi >= 60 ? 'rightHand' : '',
                  coachPlayed.has(key.midi) ? 'partial' : '',
                  upcomingTargets.has(key.midi) ? 'upcoming' : '',
                ].join(' ')}
                style={{
                  '--accent': noteColor(key.midi),
                  left: `calc(${(key.left / whiteCount) * 100}% - 0.28%)`,
                  width: `${(0.58 / whiteCount) * 100}%`,
                }}
                title={key.name}
              >
                <span>{showKeyLabels || currentTargets.has(key.midi) ? key.name : ''}</span>
              </button>
            ))}
          </div>

          {correctPressed > 0 && <div className="matchPulse">Nice: {correctPressed} target note{correctPressed === 1 ? '' : 's'}</div>}
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
