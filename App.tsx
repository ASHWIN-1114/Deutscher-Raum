
import React, { useState, useEffect, useCallback, useRef, FC, PropsWithChildren, FormEvent } from 'react';
import { initializeApp, FirebaseApp } from "firebase/app";
import { getFirestore, doc, setDoc, onSnapshot, deleteDoc, Firestore } from "firebase/firestore";
import type { Unsubscribe } from "firebase/firestore";
import type { Student, Topic, Team, GameMode, HangmanState } from './types';

// QRCode is loaded from a script in index.html, so we declare it as a global variable
declare var QRCode: any;

// --- CONFIGURATION ---
// IMPORTANT: For the QR Code feature to work on other devices (like a phone scanning a laptop screen),
// you MUST replace this empty string with the public URL where this app is hosted.
// For local testing, you can use your computer's local network IP address (e.g., 'http://192.168.1.123:5173').
const APP_BASE_URL = ''; 

// --- FIREBASE CONFIGURATION & INITIALIZATION ---
const firebaseConfig = {
    apiKey: "AIzaSyBiKsGhYowy01R8gBLJqYQXeiXL-sFTZzA",
    authDomain: "unterricht-tool.firebaseapp.com",
    projectId: "unterricht-tool",
    storageBucket: "unterricht-tool.appspot.com",
    messagingSenderId: "54878761466",
    appId: "1:54878761466:web:3f6ddaa0ed05023f9e7443"
};

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
} catch (e) {
    console.error("Firebase initialization failed:", e);
}

const firebaseService = {
    listenForWords: (sessionId: string, callback: (words: string[]) => void): Unsubscribe | null => {
        if (!db) return null;
        const sessionDocRef = doc(db, "sessions", sessionId);
        return onSnapshot(sessionDocRef, (doc) => {
            if (doc.exists() && doc.data().words) {
                callback(doc.data().words);
            }
        });
    },
    sendWords: async (sessionId: string, words: string[]): Promise<void> => {
        if (!db) throw new Error("Firestore is not initialized.");
        const sessionDocRef = doc(db, "sessions", sessionId);
        await setDoc(sessionDocRef, { words }, { merge: true });
    },
    createSession: async (sessionId: string): Promise<void> => {
        if (!db) throw new Error("Firestore is not initialized.");
        const sessionDocRef = doc(db, "sessions", sessionId);
        await setDoc(sessionDocRef, { createdAt: new Date() });
    },
    cleanupSession: async (sessionId: string): Promise<void> => {
        if (!db) return;
        const sessionDocRef = doc(db, "sessions", sessionId);
        await deleteDoc(sessionDocRef);
    }
};


// --- CUSTOM HOOKS ---
function useLocalStorage<T,>(key: string, initialValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.log(error);
      return initialValue;
    }
  });

  const setValue: React.Dispatch<React.SetStateAction<T>> = (value) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.log(error);
    }
  };

  return [storedValue, setValue];
}


// --- SOUND ENGINE ---
let audioCtx: AudioContext | null = null;
const initAudio = () => {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch (e) {
      console.error("Web Audio API is not supported");
    }
  }
};

// FIX: 'noise' is not a valid OscillatorType. The 'explosion' sound is now generated using an AudioBuffer with random data.
const playSound = (type: 'click' | 'correct' | 'wrong' | 'win' | 'defeat' | 'explosion') => {
  if (!audioCtx || audioCtx.state === 'suspended') return;
  
  if (type === 'explosion') {
    const g = audioCtx.createGain();
    g.connect(audioCtx.destination);
    const duration = 0.5;
    const bufferSize = audioCtx.sampleRate * duration;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
    }
    const noiseSource = audioCtx.createBufferSource();
    noiseSource.buffer = buffer;
    noiseSource.connect(g);

    g.gain.setValueAtTime(0.2, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(1e-4, audioCtx.currentTime + duration);

    noiseSource.start();
    noiseSource.stop(audioCtx.currentTime + duration);
    return;
  }

  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.connect(g);
  g.connect(audioCtx.destination);
  o.type = 'square';
  switch(type) {
    case 'click': o.frequency.setValueAtTime(440, audioCtx.currentTime); g.gain.setValueAtTime(0.05, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(1e-4, audioCtx.currentTime + 0.1); break;
    case 'correct': o.frequency.setValueAtTime(523.25, audioCtx.currentTime); g.gain.setValueAtTime(0.08, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(1e-4, audioCtx.currentTime + 0.2); break;
    case 'wrong': o.frequency.setValueAtTime(220, audioCtx.currentTime); g.gain.setValueAtTime(0.08, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(1e-4, audioCtx.currentTime + 0.2); break;
    case 'win': o.frequency.setValueAtTime(523.25, audioCtx.currentTime); o.frequency.linearRampToValueAtTime(1046.5, audioCtx.currentTime + 0.2); g.gain.setValueAtTime(0.1, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(1e-4, audioCtx.currentTime + 0.2); break;
    case 'defeat': o.frequency.setValueAtTime(300, audioCtx.currentTime); o.frequency.linearRampToValueAtTime(150, audioCtx.currentTime + 0.4); g.gain.setValueAtTime(0.15, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(1e-4, audioCtx.currentTime + 0.4); break;
  }
  o.start();
  o.stop(audioCtx.currentTime + 1);
};


// --- REUSABLE UI COMPONENTS ---

const baseBtnClasses = "transition-all duration-50 ease-in-out cursor-pointer disabled:cursor-not-allowed";
const pixelBtnClasses = `p-3 text-sm ${baseBtnClasses} bg-[#5a8cdb] text-[#f0f0f0] border-4 border-[#f0f0f0] shadow-[inset_-4px_-4px_0px_0px_#3a6ab1] hover:enabled:bg-[#6aa0e2] hover:enabled:shadow-[inset_-4px_-4px_0px_0px_#3a6ab1,0_0_10px_var(--accent-glow)] active:enabled:translate-x-0.5 active:enabled:translate-y-0.5 active:enabled:shadow-none disabled:bg-[#3e4466] disabled:text-gray-400 disabled:border-gray-500 disabled:shadow-[inset_-4px_-4px_0px_0px_#2c3048]`;
const pixelBtnRedClasses = `bg-[#db5a5a] shadow-[inset_-4px_-4px_0px_0px_#b13a3a] hover:enabled:bg-[#e26a6a]`;
const pixelBtnGreenClasses = `bg-[#5adb5a] shadow-[inset_-4px_-4px_0px_0px_#3ab13a] hover:enabled:bg-[#6ae26a]`;
const pixelBtnYellowClasses = `bg-[#dbc65a] shadow-[inset_-4px_-4px_0px_0px_#b1a03a] hover:enabled:bg-[#e2d06a]`;

interface PixelBtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  color?: 'blue' | 'red' | 'green' | 'yellow';
}
const PixelBtn: FC<PixelBtnProps> = ({ children, className, color = 'blue', ...props }) => {
  const colorClass = {
    blue: '',
    red: pixelBtnRedClasses,
    green: pixelBtnGreenClasses,
    yellow: pixelBtnYellowClasses,
  }[color];
  return <button className={`${pixelBtnClasses} ${colorClass} ${className}`} {...props}>{children}</button>;
};

const pixelBoxClasses = "bg-[#2c3048] border-4 border-[#f0f0f0] shadow-[inset_0_0_0_4px_#1a1c2c]";
const PixelBox: FC<PropsWithChildren<{ className?: string }>> = ({ children, className }) => {
  return <div className={`${pixelBoxClasses} ${className}`}>{children}</div>;
};

const pixelInputClasses = "bg-[#0a0a0a] border-4 border-[#f0f0f0] shadow-[inset_4px_4px_0px_0px_#000] text-[#f0f0f0] focus:outline-none focus:border-[color:var(--accent-color)] appearance-none";
const PixelInput: FC<React.InputHTMLAttributes<HTMLInputElement>> = ({ className, ...props }) => {
  return <input className={`${pixelInputClasses} ${className}`} {...props} />;
};
const PixelTextarea: FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = ({ className, ...props }) => {
    return <textarea className={`${pixelInputClasses} ${className}`} {...props} />;
};

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}
const Modal: FC<ModalProps> = ({ isOpen, onClose, children }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`${pixelBoxClasses} p-6 w-full max-w-md text-center`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
};


// --- BACKGROUND & LAYOUT COMPONENTS ---

const Starfield: FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let stars: { x: number; y: number; size: number; speed: number }[] = [];
        let animationFrameId: number;

        const resize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            const numStars = window.innerWidth < 768 ? 100 : 200;
            stars = [];
            for (let i = 0; i < numStars; i++) {
                stars.push({
                    x: Math.random() * canvas.width,
                    y: Math.random() * canvas.height,
                    size: Math.random() * 2 + 1,
                    speed: Math.random() * 0.5 + 0.1,
                });
            }
        };

        const draw = () => {
            if (!ctx) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#f0f0f0';
            stars.forEach(s => {
                s.y += s.speed;
                if (s.y > canvas.height) {
                    s.y = 0;
                    s.x = Math.random() * canvas.width;
                }
                ctx.fillRect(s.x, s.y, s.size, s.size);
            });
            animationFrameId = requestAnimationFrame(draw);
        };

        resize();
        draw();
        window.addEventListener('resize', resize);

        return () => {
            window.removeEventListener('resize', resize);
            cancelAnimationFrame(animationFrameId);
        };
    }, []);

    return <canvas ref={canvasRef} id="starfield" />;
};

// --- FEATURE COMPONENTS ---

const ClassroomTools: FC<{ playSound: (type: any) => void }> = ({ playSound }) => {
    const [students, setStudents] = useLocalStorage<Student[]>('students_data', []);
    const [topics, setTopics] = useLocalStorage<Topic[]>('topics_data', []);
    const [unpickedStudents, setUnpickedStudents] = useLocalStorage<string[]>('unpicked_students', []);
    
    const [studentName, setStudentName] = useState('');
    const [topicName, setTopicName] = useState('');
    const [numGroups, setNumGroups] = useState(2);
    const [groups, setGroups] = useState<{ students: string[]; topic: string | null; }[]>([]);
    const [message, setMessage] = useState('');
    const [isPicking, setIsPicking] = useState(false);
    const [animationNames, setAnimationNames] = useState<string[]>([]);
    const [animationTargetPos, setAnimationTargetPos] = useState(0);

    const presentStudents = students.filter(s => !s.absent);

    const handleAddStudent = (e: FormEvent) => {
        e.preventDefault();
        if (studentName.trim()) {
            playSound('click');
            const newStudent = { name: studentName.trim(), absent: false };
            setStudents(prev => [...prev, newStudent]);
            setUnpickedStudents(prev => [...prev, newStudent.name]);
            setStudentName('');
        }
    };

    const handleRemoveStudent = (indexToRemove: number) => {
        playSound('click');
        const removedStudentName = students[indexToRemove].name;
        setStudents(prev => prev.filter((_, i) => i !== indexToRemove));
        setUnpickedStudents(prev => prev.filter(name => name !== removedStudentName));
    };

    const handleToggleAbsent = (indexToToggle: number) => {
        playSound('click');
        setStudents(prev => prev.map((s, i) => i === indexToToggle ? { ...s, absent: !s.absent } : s));
    };

    const handleAddTopic = (e: FormEvent) => {
        e.preventDefault();
        if (topicName.trim()) {
            playSound('click');
            setTopics(prev => [...prev, topicName.trim()]);
            setTopicName('');
        }
    };
    
    const handleRemoveTopic = (indexToRemove: number) => {
        playSound('click');
        setTopics(prev => prev.filter((_, i) => i !== indexToRemove));
    };

    const handleSplitGroups = () => {
        playSound('click');
        setAnimationNames([]);
        const presentStudentNames = presentStudents.map(s => s.name);
        if (!presentStudentNames.length || numGroups < 1 || numGroups > presentStudentNames.length) {
            setMessage('Ungültige Gruppenzahl.');
            return;
        }
        setMessage('');

        const shuffleArray = <T,>(array: T[]): T[] => {
            const newArr = [...array];
            for (let i = newArr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
            }
            return newArr;
        }

        const shuffledStudents = shuffleArray(presentStudentNames);
        const shuffledTopics = shuffleArray(topics);
        const createdGroups = Array.from({ length: numGroups }, () => ({ students: [] as string[], topic: null as string | null }));
        
        shuffledStudents.forEach((student, i) => {
            createdGroups[i % numGroups].students.push(student);
        });

        if (shuffledTopics.length > 0) {
            createdGroups.forEach((group, i) => {
                group.topic = shuffledTopics[i % shuffledTopics.length];
            });
        }
        
        setGroups(createdGroups);
    };

    const handleRandomPerson = () => {
        playSound('click');
        setGroups([]);
        
        const presentStudentNames = presentStudents.map(s => s.name);
        if (presentStudentNames.length === 0) {
            setMessage('Keine anwesenden Schüler.');
            return;
        }
        
        let currentUnpicked = unpickedStudents.filter(name => presentStudentNames.includes(name));
        if (currentUnpicked.length === 0) {
            currentUnpicked = [...presentStudentNames];
            setMessage('Alle Schüler wurden aufgerufen! Zyklus startet neu.');
        } else {
            setMessage('');
        }

        setIsPicking(true);
        const selectedStudent = currentUnpicked[Math.floor(Math.random() * currentUnpicked.length)];
        setUnpickedStudents(currentUnpicked.filter(s => s !== selectedStudent));
        
        const namesForAnim = [];
        for (let i = 0; i < 20; i++) {
            namesForAnim.push(...presentStudentNames.sort(() => Math.random() - 0.5));
        }
        const finalPositionIndex = namesForAnim.length - Math.floor(presentStudentNames.length / 2) - 1;
        namesForAnim[finalPositionIndex] = selectedStudent;
        setAnimationNames(namesForAnim);

        setTimeout(() => {
            const listEl = document.getElementById('scrolling-names-list');
            const wrapperEl = document.getElementById('scrolling-names-list-wrapper');
            const finalEl = listEl?.children[finalPositionIndex] as HTMLElement;
            if (listEl && wrapperEl && finalEl) {
                const wrapperWidth = wrapperEl.offsetWidth;
                const finalElPos = finalEl.offsetLeft + finalEl.offsetWidth / 2;
                setAnimationTargetPos(finalElPos - wrapperWidth / 2);
            }
        }, 100);
    };
    
    const handleResetRandom = () => {
        playSound('click');
        setUnpickedStudents([]);
        setMessage('Zufalls-Zyklus zurückgesetzt.');
    };

    return (
        <>
            <div className="flex flex-col md:flex-row items-center justify-center gap-6 md:gap-10 mb-8">
                <div className="flex items-center gap-4">
                    <label htmlFor="num-groups" className="text-sm">Gruppen:</label>
                    <PixelInput type="number" id="num-groups" value={numGroups} onChange={e => setNumGroups(parseInt(e.target.value, 10))} min="1" className="w-20 p-2 text-center" />
                </div>
                <PixelBtn onClick={handleSplitGroups} className="w-full md:w-auto p-4 text-sm">Gruppen bilden</PixelBtn>
                <PixelBtn onClick={handleRandomPerson} disabled={isPicking} className="w-full md:w-auto p-4 text-sm">Zufall</PixelBtn>
            </div>
            <PixelBox className="p-6 mb-8 min-h-[150px]">
                <div className="flex justify-between items-center mb-2">
                     <h2 className="text-lg text-center flex-grow text-glow">Ergebnisse</h2>
                     {animationNames.length > 0 && <PixelBtn color="yellow" onClick={handleResetRandom} className="p-2 text-xs">Reset</PixelBtn>}
                </div>
                <div id="random-person-animation-container" className="mb-4 text-center text-2xl font-bold h-[40px] flex items-center justify-center">
                    {animationNames.length > 0 && (
                        <div id="scrolling-names-list-wrapper" className="overflow-hidden w-full h-full">
                            <div 
                                id="scrolling-names-list"
                                className="flex flex-row items-center h-full"
                                style={{ transform: `translateX(-${animationTargetPos}px)`, transition: 'transform 3s cubic-bezier(0.25, 0.1, 0.25, 1)' }}
                                onTransitionEnd={() => { playSound('win'); setIsPicking(false); }}
                            >
                                {animationNames.map((name, i) => (
                                    <p key={i} className={`p-2 text-2xl mx-4 whitespace-nowrap ${i === animationNames.length - Math.floor(presentStudents.length / 2) - 1 && !isPicking ? 'text-cyan-400 text-glow' : ''}`}>
                                        {name}
                                    </p>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
                {groups.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {groups.map((group, index) => (
                            <PixelBox key={index} className="!bg-[#1a1c2c] p-6 flex flex-col gap-4">
                                <h3 className="text-md text-center">Gruppe {index + 1}</h3>
                                {group.topic && <p className="text-center text-sm">Thema: <span className="text-cyan-400">{group.topic}</span></p>}
                                <ul className="space-y-2">
                                    {group.students.map(s => <li key={s} className="p-2 bg-[#0a0a0a] text-sm">{s}</li>)}
                                </ul>
                            </PixelBox>
                        ))}
                    </div>
                )}
                {message && <p className="mt-4 text-center text-yellow-300 font-semibold">{message}</p>}
            </PixelBox>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10">
                <PixelBox className="p-6">
                    <h2 className="text-lg text-center text-glow">Schüler</h2>
                    <p className="text-sm text-center mb-4">({presentStudents.length} / {students.length} anwesend)</p>
                    <form onSubmit={handleAddStudent} className="flex gap-4">
                        <PixelInput type="text" value={studentName} onChange={e => setStudentName(e.target.value)} placeholder="Name..." className="flex-1 p-3 text-sm" />
                        <PixelBtn type="submit" className="p-3 text-sm">Add</PixelBtn>
                    </form>
                    <div className="mt-4 scroll-container max-h-60 overflow-y-auto">
                        <ul className="space-y-2">
                            {students.map((student, index) => (
                                <li key={index} className="flex items-center justify-between p-2 pr-3 bg-[#0a0a0a]">
                                    <span className={`text-sm flex-grow ${student.absent ? 'text-gray-500 line-through' : ''}`}>{student.name}</span>
                                    <div className="flex items-center gap-4">
                                        <label className="flex items-center cursor-pointer">
                                            <span className="mr-2 text-xs">Abwesend</span>
                                            <input type="checkbox" checked={student.absent} onChange={() => handleToggleAbsent(index)} className="appearance-none w-[60px] h-[30px] border-4 border-[#f0f0f0] bg-[#5adb5a] relative cursor-pointer checked:bg-[#db5a5a] before:content-[''] before:absolute before:top-[2px] before:left-[2px] before:w-[18px] before:h-[18px] before:bg-[#f0f0f0] before:transition-transform before:duration-100 before:ease-linear checked:before:translate-x-[28px]" />
                                        </label>
                                        <button onClick={() => handleRemoveStudent(index)} className="text-red-400 hover:text-red-300 font-bold">[X]</button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>
                </PixelBox>
                <PixelBox className="p-6">
                    <h2 className="text-lg mb-4 text-center text-glow">Themen</h2>
                    <form onSubmit={handleAddTopic} className="flex gap-4">
                        <PixelInput type="text" value={topicName} onChange={e => setTopicName(e.target.value)} placeholder="Thema..." className="flex-1 p-3 text-sm" />
                        <PixelBtn type="submit" className="p-3 text-sm">Add</PixelBtn>
                    </form>
                     <div className="mt-4 scroll-container max-h-60 overflow-y-auto">
                        <ul className="space-y-2">
                             {topics.map((topic, index) => (
                                <li key={index} className="flex items-center justify-between p-2 bg-[#0a0a0a]">
                                    <span className="text-sm">{topic}</span>
                                    <button onClick={() => handleRemoveTopic(index)} className="remove-topic-btn text-red-400 hover:text-red-300 font-bold">[X]</button>
                                </li>
                            ))}
                        </ul>
                    </div>
                </PixelBox>
            </div>
        </>
    );
};

const HangmanFigure: FC<{ wrongGuesses: number }> = ({ wrongGuesses }) => {
    const destructionOrder = ['astro-leg-right', 'astro-leg-left', 'astro-arm-right', 'astro-arm-left', 'astro-body', 'astro-head'];
    const [explosions, setExplosions] = useState<{ id: number, x: number, y: number }[]>([]);

    useEffect(() => {
        if (wrongGuesses > 0 && wrongGuesses <= destructionOrder.length) {
            const partId = destructionOrder[wrongGuesses - 1];
            // FIX: Cast to unknown first to allow conversion from HTMLElement to SVGGraphicsElement, which is the correct type for SVG elements like <g>.
            const partElement = document.getElementById(partId) as unknown as SVGGraphicsElement | null;
            if (partElement) {
                playSound('explosion');
                const bbox = partElement.getBBox();
                const newExplosion = {
                    id: Date.now(),
                    x: bbox.x + bbox.width / 2,
                    y: bbox.y + bbox.height / 2,
                };
                setExplosions(prev => [...prev, newExplosion]);
                setTimeout(() => setExplosions(prev => prev.filter(ex => ex.id !== newExplosion.id)), 300);
            }
        }
    }, [wrongGuesses]);

    const isDefeated = wrongGuesses >= destructionOrder.length;

    return (
        <div className="relative w-48 h-56 mb-4">
            <svg viewBox="0 0 100 120" className="w-full h-full">
                <defs>
                    <g id="explosion-sprite">
                        <rect x="-8" y="-8" width="4" height="4" fill="#FFD700" /><rect x="4" y="-8" width="4" height="4" fill="#FFA500" /><rect x="-8" y="4" width="4" height="4" fill="#FF4500" /><rect x="4" y="4" width="4" height="4" fill="#FFD700" /><rect x="-2" y="-12" width="4" height="4" fill="#FFA500" /><rect x="-2" y="8" width="4" height="4" fill="#FF6347" /><rect x="-12" y="-2" width="4" height="4" fill="#FF4500" /><rect x="8" y="-2" width="4" height="4" fill="#FFA500" />
                    </g>
                </defs>
                <g className="stroke-[#9ca3af] stroke-[6px]">
                    <line x1="20" y1="110" x2="80" y2="110" /> <line x1="30" y1="110" x2="30" y2="10" /> <line x1="25" y1="10" x2="70" y2="10" /> <line x1="70" y1="10" x2="70" y2="25" />
                </g>
                <g id="hangman-figure" className={isDefeated ? 'is-defeated' : ''}>
                    <g id="astro-leg-right" transform="translate(68, 68) scale(1.5)" style={{ visibility: wrongGuesses >= 1 ? 'hidden' : 'visible' }}><rect x="4" y="0" width="7" height="7" fill="#bdc3c7"/><rect x="10" y="0" width="1" height="7" fill="#7f8c8d"/><rect x="4" y="7" width="8" height="2" fill="#7f8c8d"/><rect x="3" y="9" width="10" height="6" fill="#7f8c8d"/><rect x="4" y="9" width="8" height="5" fill="#2c3e50"/><rect x="3" y="14" width="10" height="1" fill="#3498db"/></g>
                    <g id="astro-leg-left" transform="translate(52, 68) scale(1.5)" style={{ visibility: wrongGuesses >= 2 ? 'hidden' : 'visible' }}><rect x="4" y="0" width="7" height="7" fill="#bdc3c7"/><rect x="10" y="0" width="1" height="7" fill="#7f8c8d"/><rect x="4" y="7" width="8" height="2" fill="#7f8c8d"/><rect x="3" y="9" width="10" height="6" fill="#7f8c8d"/><rect x="4" y="9" width="8" height="5" fill="#2c3e50"/><rect x="3" y="14" width="10" height="1" fill="#3498db"/></g>
                    <g id="astro-arm-right" transform="translate(78, 44) scale(1.5)" style={{ visibility: wrongGuesses >= 3 ? 'hidden' : 'visible' }}><rect x="4" y="0" width="8" height="5" fill="#7f8c8d"/><rect x="5" y="1" width="6" height="3" fill="#bdc3c7"/><rect x="6" y="1" width="4" height="1" fill="#ecf0f1"/><rect x="5" y="5" width="6" height="5" fill="#bdc3c7"/><rect x="10" y="5" width="1" height="5" fill="#7f8c8d"/><rect x="4" y="10" width="8" height="4" fill="#7f8c8d"/><rect x="5" y="11" width="6" height="2" fill="#2c3e50"/></g>
                    <g id="astro-arm-left" transform="translate(42, 44) scale(1.5)" style={{ visibility: wrongGuesses >= 4 ? 'hidden' : 'visible' }}><rect x="4" y="0" width="8" height="5" fill="#7f8c8d"/><rect x="5" y="1" width="6" height="3" fill="#bdc3c7"/><rect x="6" y="1" width="4" height="1" fill="#ecf0f1"/><rect x="5" y="5" width="6" height="5" fill="#bdc3c7"/><rect x="10" y="5" width="1" height="5" fill="#7f8c8d"/><rect x="4" y="10" width="8" height="4" fill="#7f8c8d"/><rect x="5" y="11" width="6" height="2" fill="#2c3e50"/></g>
                    <g id="astro-body" transform="translate(60, 40) scale(1.5)" style={{ visibility: wrongGuesses >= 5 ? 'hidden' : 'visible' }}><rect x="2" y="2" width="12" height="12" fill="#7f8c8d"/><rect x="3" y="1" width="10" height="13" fill="#bdc3c7"/><rect x="4" y="1" width="7" height="13" fill="#ecf0f1"/><rect x="5" y="4" width="6" height="5" fill="#7f8c8d"/><rect x="6" y="5" width="4" height="3" fill="#2c3e50"/><rect x="6" y="6" width="1" height="1" fill="#e74c3c"/><rect x="8" y="6" width="2" height="1" fill="#3498db"/></g>
                    <g id="astro-head" transform="translate(62, 23) scale(1.5)" style={{ visibility: wrongGuesses >= 6 ? 'hidden' : 'visible' }}><rect x="5" y="2" width="6" height="1" fill="#ecf0f1"/><rect x="4" y="3" width="8" height="1" fill="#ecf0f1"/><rect x="3" y="4" width="10" height="7" fill="#bdc3c7"/><rect x="4" y="11" width="8" height="1" fill="#7f8c8d"/><rect x="12" y="5" width="1" height="5" fill="#7f8c8d"/><rect x="4" y="5" width="8" height="5" fill="#2c3e50"/><rect x="5" y="6" width="2" height="1" fill="#ecf0f1"/><rect x="5" y="7" width="1" height="1" fill="#bdc3c7"/><rect x="2" y="6" width="1" height="3" fill="#bdc3c7"/><rect x="1" y="7" width="1" height="1" fill="#7f8c8d"/></g>
                </g>
                <g id="explosions-container">
                    {explosions.map(ex => <use key={ex.id} href="#explosion-sprite" transform={`translate(${ex.x} ${ex.y})`} className="exploding" />)}
                </g>
            </svg>
        </div>
    );
};

const HangmanGame: FC<{ playSound: (type: any) => void }> = ({ playSound }) => {
    const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ'.split('');
    const MAX_WRONG_GUESSES = 6;
    const initialGameState: HangmanState = { teams: [], currentTeamIndex: 0, selectedWord: '', correctLetters: [], wrongLetters: [], isRoundOver: true, wordList: [], currentWordIndex: 0, };

    const [gameMode, setGameMode] = useState<GameMode>('single');
    const [numTeams, setNumTeams] = useState(2);
    const [gameState, setGameState] = useState<HangmanState>(initialGameState);
    const [message, setMessage] = useState('');
    const [isGameActive, setIsGameActive] = useState(false);

    // Modal states
    const [isRulesModalOpen, setRulesModalOpen] = useState(false);
    const [isGuessWordModalOpen, setGuessWordModalOpen] = useState(false);
    const [isDirectWordModalOpen, setDirectWordModalOpen] = useState(false);
    const [isQrCodeModalOpen, setQrCodeModalOpen] = useState(false);

    const [guessWordInput, setGuessWordInput] = useState('');
    const [directWordInput, setDirectWordInput] = useState('');
    const [isDirectWordVisible, setDirectWordVisible] = useState(false);

    const [qrStatus, setQrStatus] = useState("Warte auf Verbindung...");
    const qrCodeContainerRef = useRef<HTMLDivElement>(null);
    const firebaseUnsubscribeRef = useRef<Unsubscribe | null>(null);

    const startGame = (words: string[]) => {
        if (!words || words.length === 0) {
            alert("Keine Wörter zum Spielen erhalten.");
            return;
        }
        setIsGameActive(true);
        setMessage('');

        const newGameState = { ...initialGameState };
        if (gameMode === 'single') {
            newGameState.teams = [{ id: 0, name: 'Spieler 1', score: 0 }];
        } else {
            if (isNaN(numTeams) || numTeams < 2) {
                alert("Ungültige Team-Anzahl.");
                setIsGameActive(false);
                return;
            }
            newGameState.teams = Array.from({ length: numTeams }, (_, i) => ({ id: i, name: `Team ${i + 1}`, score: 0 }));
        }
        newGameState.wordList = words.map(w => w.toUpperCase());
        setGameState(newGameState);
        startNewRound(newGameState);
    };

    const startNewRound = (currentState: HangmanState) => {
        if (currentState.currentWordIndex >= currentState.wordList.length) {
            endGame(currentState);
            return;
        }
        setMessage('');
        setGameState(prev => ({
            ...prev,
            selectedWord: prev.wordList[prev.currentWordIndex],
            currentWordIndex: prev.currentWordIndex + 1,
            correctLetters: [],
            wrongLetters: [],
            isRoundOver: false,
        }));
    };
    
    const handleGuess = (letter: string) => {
        if (gameState.isRoundOver) return;

        const upperLetter = letter.toUpperCase();

        if (gameState.selectedWord.includes(upperLetter)) {
            playSound('correct');
            if (!gameState.correctLetters.includes(upperLetter)) {
                const newCorrectLetters = [...gameState.correctLetters, upperLetter];
                const points = 5 * gameState.selectedWord.split(upperLetter).length - 1;
                awardPoints(points);
                
                const isWordGuessed = gameState.selectedWord.split('').every(l => newCorrectLetters.includes(l));
                if (isWordGuessed) {
                    endRound(true, { ...gameState, correctLetters: newCorrectLetters });
                    awardPoints(10); // Bonus for completing word
                } else {
                    setGameState(prev => ({ ...prev, correctLetters: newCorrectLetters }));
                }
            }
        } else {
            playSound('wrong');
            if (!gameState.wrongLetters.includes(upperLetter)) {
                const newWrongLetters = [...gameState.wrongLetters, upperLetter];
                if (newWrongLetters.length >= MAX_WRONG_GUESSES) {
                    endRound(false, { ...gameState, wrongLetters: newWrongLetters });
                } else {
                    changeTurn();
                    setGameState(prev => ({ ...prev, wrongLetters: newWrongLetters }));
                }
            }
        }
    };

    const awardPoints = (points: number) => {
        if (gameMode === 'single') return;
        setGameState(prev => {
            const newTeams = [...prev.teams];
            newTeams[prev.currentTeamIndex].score += points;
            return { ...prev, teams: newTeams };
        });
    };

    const changeTurn = () => {
        if (gameMode === 'single') return;
        setGameState(prev => ({
            ...prev,
            currentTeamIndex: (prev.currentTeamIndex + 1) % prev.teams.length
        }));
    };

    const endRound = (isWin: boolean, finalState: HangmanState) => {
        setGameState({ ...finalState, isRoundOver: true });
        if (isWin) {
            playSound('win');
            const winnerName = gameMode === 'team' ? finalState.teams[finalState.currentTeamIndex].name : 'Du hast';
            setMessage(`${winnerName} GEWONNEN!`);
        } else {
            playSound('defeat');
            setTimeout(() => {
                setMessage(`VERLOREN! Wort: ${finalState.selectedWord}`);
            }, 500);
        }
    };
    
    const endGame = (finalState: HangmanState) => {
        setGameState({ ...finalState, isRoundOver: true });
        let endMessage = 'Alle Wörter gespielt!';
        if (gameMode === 'team' && finalState.teams.length > 0) {
            const winner = finalState.teams.reduce((p, c) => (p.score > c.score) ? p : c);
            endMessage = `${winner.name} gewinnt!`;
        }
        setMessage(`SPIELENDE! ${endMessage}`);
    };

    const handleSubmitWordGuess = () => {
        const guess = guessWordInput.trim().toUpperCase();
        if (!guess) return;
        if (guess === gameState.selectedWord) {
            playSound('win');
            awardPoints(25);
            endRound(true, { ...gameState, correctLetters: gameState.selectedWord.split('') });
        } else {
            playSound('wrong');
            setMessage('Falsch geraten!');
            changeTurn();
        }
        setGuessWordModalOpen(false);
        setGuessWordInput('');
    };

    const handleStartDirectWordGame = () => {
        const word = directWordInput.trim();
        if (word) {
            startGame([word]);
            setDirectWordModalOpen(false);
            setDirectWordInput('');
        } else {
            alert("Bitte ein Wort eingeben.");
        }
    };

    const handleQrCodeGame = async () => {
        if (!db) {
            alert("Firebase ist nicht korrekt konfiguriert.");
            return;
        }
        playSound('click');
        const sessionId = "hangman_" + Math.random().toString(36).substring(2, 10);
        try {
            await firebaseService.createSession(sessionId);
            
            const baseUrl = (APP_BASE_URL || (window.location.origin + window.location.pathname)).replace(/\/$/, '');
            if (!APP_BASE_URL) {
                console.warn(
                    "WARNING: APP_BASE_URL is not set in App.tsx. " +
                    "The QR code may not work if you scan it with a different device. " +
                    "Please set it to your app's public URL for it to work reliably."
                );
            }
            const url = `${baseUrl}?session=${sessionId}`;

            setQrCodeModalOpen(true);
            setQrStatus("Warte auf Verbindung...");

            setTimeout(() => {
                if (qrCodeContainerRef.current) {
                    qrCodeContainerRef.current.innerHTML = '';
                    new QRCode(qrCodeContainerRef.current, { text: url, width: 200, height: 200 });
                }
            }, 100);

            firebaseUnsubscribeRef.current = firebaseService.listenForWords(sessionId, (words) => {
                setQrCodeModalOpen(false);
                startGame(words);
                if (firebaseUnsubscribeRef.current) {
                    firebaseUnsubscribeRef.current();
                    firebaseUnsubscribeRef.current = null;
                }
                firebaseService.cleanupSession(sessionId);
            });

        } catch (error) {
            console.error("Error creating QR code session:", error);
            setQrStatus("Fehler beim Erstellen der Sitzung.");
        }
    };
    
    const cancelQrCodeGame = () => {
        if (firebaseUnsubscribeRef.current) {
            firebaseUnsubscribeRef.current();
            firebaseUnsubscribeRef.current = null;
        }
        setQrCodeModalOpen(false);
    };

    const isWordGuessed = gameState.selectedWord.split('').every(l => gameState.correctLetters.includes(l));
    
    return (
        <div className="w-full">
            <PixelBox className="p-6">
                <div className="text-center mb-6 relative">
                    <h2 className="text-2xl text-glow">Galgenmännchen</h2>
                    <button onClick={() => setRulesModalOpen(true)} className="absolute top-0 right-0 p-2">[?]</button>
                </div>
                {!isGameActive ? (
                    <div className="flex flex-col gap-4 mb-6 p-4 bg-[#0a0a0a]">
                        <h3 className="text-lg text-center -mb-2">Settings</h3>
                        <div className="flex-1">
                            <label className="mb-2 block text-center text-sm">Modus</label>
                            <div className="grid grid-cols-2 gap-2">
                                <button onClick={() => setGameMode('single')} className={`p-2 text-sm border-4 border-[#f0f0f0] ${gameMode === 'single' ? 'bg-[#db5a5a]' : ''}`}>Einzel</button>
                                <button onClick={() => setGameMode('team')} className={`p-2 text-sm border-4 border-[#f0f0f0] ${gameMode === 'team' ? 'bg-[#db5a5a]' : ''}`}>Team</button>
                            </div>
                        </div>
                        {gameMode === 'team' && (
                            <div className="flex-1">
                                <label htmlFor="num-teams-input" className="mb-2 block text-center text-sm">Teams</label>
                                <PixelInput type="number" id="num-teams-input" value={numTeams} onChange={(e) => setNumTeams(parseInt(e.target.value, 10))} min="2" className="w-full p-2 text-center" />
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-2 mt-2">
                            <PixelBtn onClick={() => setDirectWordModalOpen(true)} className="w-full p-3 text-sm">Wort eingeben</PixelBtn>
                            <PixelBtn color="yellow" onClick={handleQrCodeGame} className="w-full p-3 text-sm">QR-Code Spiel</PixelBtn>
                        </div>
                    </div>
                ) : (
                    <>
                    {gameMode === 'team' && (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
                            {gameState.teams.map((team, index) => (
                                <PixelBox key={team.id} className={`p-3 text-center transition-colors ${index === gameState.currentTeamIndex ? 'border-[color:var(--accent-color)]' : ''}`}>
                                    <p className="text-sm">{team.name}</p>
                                    <p className="text-xl">{team.score}</p>
                                </PixelBox>
                            ))}
                        </div>
                    )}
                    <div className="flex flex-col items-center gap-4">
                        <HangmanFigure wrongGuesses={gameState.wrongLetters.length} />
                        <div className="flex gap-2 text-3xl tracking-widest flex-wrap justify-center">
                            {gameState.selectedWord.split('').map((letter, i) => (
                                <span key={i} className={`inline-block w-8 text-center border-b-4 border-gray-400 ${gameState.correctLetters.includes(letter) && isWordGuessed ? 'letter-reveal' : ''}`}>
                                    {gameState.correctLetters.includes(letter) ? letter : <span className="text-transparent">_</span>}
                                </span>
                            ))}
                        </div>
                        <div className="text-center text-sm">
                            <p>Falsch:</p>
                            <p className="text-red-400 min-h-[28px] tracking-widest">{gameState.wrongLetters.join(' ')}</p>
                        </div>
                        <div className="flex flex-wrap justify-center gap-2 max-w-lg">
                            {ALPHABET.map(letter => (
                                <PixelBtn key={letter} onClick={() => handleGuess(letter)} disabled={gameState.correctLetters.includes(letter) || gameState.wrongLetters.includes(letter) || gameState.isRoundOver} className="py-2 px-3 text-sm shadow-[inset_-2px_-2px_0px_0px_#3a6ab1]">
                                    {letter}
                                </PixelBtn>
                            ))}
                        </div>
                        <div className="text-2xl text-center min-h-[40px] font-bold">
                            <span className={isWordGuessed ? "text-cyan-400" : "text-yellow-300"}>{message}</span>
                        </div>
                        <div className="flex items-center gap-4 mt-4">
                            {!gameState.isRoundOver && <PixelBtn onClick={() => setGuessWordModalOpen(true)}>Wort raten</PixelBtn>}
                            {gameState.isRoundOver && gameState.currentWordIndex < gameState.wordList.length && <PixelBtn color="green" onClick={() => startNewRound(gameState)}>Nächste Runde</PixelBtn>}
                            {gameState.isRoundOver && <PixelBtn color="red" onClick={() => { setIsGameActive(false); setGameState(initialGameState); setMessage('')}}>Spiel beenden</PixelBtn>}
                        </div>
                    </div>
                    </>
                )}
            </PixelBox>

            {/* Modals */}
            <Modal isOpen={isRulesModalOpen} onClose={() => setRulesModalOpen(false)}>
                <div className="flex justify-between items-center mb-4"><h3 className="text-lg">Spielregeln</h3><PixelBtn color="red" onClick={() => setRulesModalOpen(false)} className="px-2 py-1">&times;</PixelBtn></div>
                <div className="space-y-4 text-sm text-left">
                    <div><h4 className="text-cyan-400">Allgemein</h4><ul className="list-disc pl-5"><li>Errate das Wort, bevor der Astronaut komplett zerstört ist (6 Fehler).</li></ul></div>
                    <div><h4 className="text-cyan-400">Einzelspieler</h4><ul className="list-disc pl-5"><li>Versuche, alle Wörter der Runde zu erraten.</li></ul></div>
                    <div><h4 className="text-cyan-400">Team-Modus</h4><ul className="list-disc pl-5"><li>Teams raten abwechselnd. Falsch = Nächstes Team.</li><li><b>Punkte:</b><ul className="list-['-_'] ml-4"><li><b>+5 Pkt.</b> pro richtiger Buchstabe.</li><li><b>+10 Bonus</b> für erratenes Wort.</li><li><b>+25 Bonus</b> für "Wort raten".</li></ul></li></ul></div>
                </div>
            </Modal>

            <Modal isOpen={isGuessWordModalOpen} onClose={() => setGuessWordModalOpen(false)}>
                <h3 className="text-lg mb-4">Wort raten</h3><p className="mb-4 text-sm">Gib das ganze Wort ein.</p>
                <PixelInput type="text" value={guessWordInput} onChange={e => setGuessWordInput(e.target.value)} onKeyUp={e => e.key === 'Enter' && handleSubmitWordGuess()} className="w-full p-2 text-center text-xl uppercase tracking-widest" />
                <div className="flex gap-4 mt-6"><PixelBtn onClick={handleSubmitWordGuess} className="w-full p-2 text-sm">OK</PixelBtn><PixelBtn color="red" onClick={() => setGuessWordModalOpen(false)} className="w-full p-2 text-sm">Abbrechen</PixelBtn></div>
            </Modal>
            
            <Modal isOpen={isDirectWordModalOpen} onClose={() => setDirectWordModalOpen(false)}>
                <h3 className="text-lg mb-4 text-glow">Geheimes Wort eingeben</h3>
                <p className="mb-4 text-sm">Das Wort ist für die Schüler nicht sichtbar.</p>
                <div className="flex items-center gap-2">
                    <PixelInput type={isDirectWordVisible ? 'text' : 'password'} value={directWordInput} onChange={e => setDirectWordInput(e.target.value)} onKeyUp={e => e.key === 'Enter' && handleStartDirectWordGame()} className="w-full p-2 text-center text-xl uppercase tracking-widest" />
                    <PixelBtn onMouseDown={() => setDirectWordVisible(true)} onMouseUp={() => setDirectWordVisible(false)} onMouseLeave={() => setDirectWordVisible(false)} className="p-2 text-sm">[?]</PixelBtn>
                </div>
                <div className="flex gap-4 mt-6"><PixelBtn onClick={handleStartDirectWordGame} className="w-full p-2 text-sm">Start</PixelBtn><PixelBtn color="red" onClick={() => setDirectWordModalOpen(false)} className="w-full p-2 text-sm">Abbrechen</PixelBtn></div>
            </Modal>

            <Modal isOpen={isQrCodeModalOpen} onClose={cancelQrCodeGame}>
                <h3 className="text-lg mb-4 text-glow">Wörter per Handy senden</h3>
                <p className="mb-4 text-sm">Scanne den QR-Code mit deinem Handy, um eine Wortliste einzugeben.</p>
                <div id="qr-code-container" ref={qrCodeContainerRef}></div>
                <p className="mt-4 text-sm">{qrStatus}</p>
                <PixelBtn color="red" onClick={cancelQrCodeGame} className="w-full p-2 text-sm mt-6">Abbrechen</PixelBtn>
            </Modal>
        </div>
    );
};

const RemoteControlView: FC = () => {
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [wordsText, setWordsText] = useState('');
    const [status, setStatus] = useState('');
    const [isSending, setIsSending] = useState(false);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        setSessionId(params.get('session'));
    }, []);

    const handleSendWords = async () => {
        if (!sessionId || !wordsText.trim()) {
            setStatus("Bitte Wörter eingeben.");
            return;
        }
        const words = wordsText.split(/[\n,]+/).map(w => w.trim().toUpperCase()).filter(w => w.length > 0);
        if (words.length === 0) {
            setStatus("Keine gültigen Wörter gefunden.");
            return;
        }
        setIsSending(true);
        setStatus("Sende...");
        try {
            await firebaseService.sendWords(sessionId, words);
            setStatus("Erfolg! Wörter gesendet.");
        } catch (error) {
            console.error(error);
            setStatus("Fehler beim Senden.");
            setIsSending(false);
        }
    };

    if (!sessionId) {
        return (
            <div className="flex flex-col min-h-screen items-center justify-center p-4 text-center">
                <h1 className="text-2xl mb-4 text-glow text-red-500">Fehler</h1>
                <PixelBox className="p-6 w-full max-w-sm">
                    <p>Keine Sitzungs-ID gefunden. Bitte scannen Sie einen neuen QR-Code vom Hauptbildschirm.</p>
                </PixelBox>
            </div>
        );
    }

    return (
        <div className="flex flex-col min-h-screen items-center justify-center p-4 text-center">
           <h1 className="text-2xl mb-4 text-glow">Wort-Fernbedienung</h1>
           <PixelBox className="p-6 w-full max-w-sm">
               <label htmlFor="word-list-input" className="text-sm mb-2 block">Wörter eingeben:</label>
               <p className="text-xs text-gray-400 mb-4">(Eins pro Zeile oder durch Komma getrennt)</p>
               <PixelTextarea id="word-list-input" rows={8} value={wordsText} onChange={e => setWordsText(e.target.value)} className="w-full p-2 text-sm" />
               <PixelBtn color="green" onClick={handleSendWords} disabled={isSending} className="w-full p-3 text-sm mt-4">Senden</PixelBtn>
               <p className={`mt-4 text-sm min-h-[20px] ${status.includes('Erfolg') ? 'text-green-400' : 'text-yellow-300'}`}>{status}</p>
           </PixelBox>
        </div>
    );
};


const App: FC = () => {
    const [view, setView] = useState<'main' | 'remote'>('main');
    const [activeTab, setActiveTab] = useState<'tools' | 'games'>('tools');
    const [isSoundOn, setSoundOn] = useState(true);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.has('session')) {
            setView('remote');
        }
        // This is a one-time setup on first user interaction
        document.body.addEventListener('click', initAudio, { once: true });
    }, []);

    const toggleSound = () => {
        initAudio();
        if (!audioCtx) return;
        setSoundOn(!isSoundOn);
        if (!isSoundOn && audioCtx.state === 'suspended') {
          audioCtx.resume();
        }
        if (isSoundOn) playSound('click');
    };

    const handleSoundClick = (type: any) => {
        if (isSoundOn) {
            playSound(type);
        }
    };

    if (view === 'remote') {
        return <RemoteControlView />;
    }

    return (
        <>
            <Starfield />
            <div className="flex flex-col min-h-screen items-center justify-start p-4">
                <header className="w-full flex justify-between items-center py-4 mb-8">
                    <div></div>
                    <h1 className="text-3xl md:text-4xl tracking-tight text-glow">Unterricht Tool 64</h1>
                    <PixelBtn onClick={toggleSound} className="p-2 text-xs">{isSoundOn ? 'Sound: ON' : 'Sound: OFF'}</PixelBtn>
                </header>

                <main className="w-full max-w-5xl shadow-2xl p-6 md:p-10 bg-[#2c3048] border-4 border-[#f0f0f0] shadow-[0_0_20px_var(--accent-glow)]">
                    <div className="flex justify-center mb-8 border-b-4 border-f0f0f0">
                        <button 
                            onClick={() => { handleSoundClick('click'); setActiveTab('tools'); }}
                            className={`font-bold py-2 px-6 border-b-4 transition-colors ${activeTab === 'tools' ? 'text-[color:var(--accent-color)] border-[color:var(--accent-color)]' : 'border-transparent'}`}>
                            Werkzeuge
                        </button>
                        <button 
                            onClick={() => { handleSoundClick('click'); setActiveTab('games'); }}
                            className={`font-bold py-2 px-6 border-b-4 transition-colors ${activeTab === 'games' ? 'text-[color:var(--accent-color)] border-[color:var(--accent-color)]' : 'border-transparent'}`}>
                            Spiele
                        </button>
                    </div>

                    {activeTab === 'tools' && <ClassroomTools playSound={handleSoundClick} />}
                    {activeTab === 'games' && <HangmanGame playSound={handleSoundClick} />}
                </main>
            </div>
        </>
    );
};

export default App;
