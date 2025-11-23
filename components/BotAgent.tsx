import React, { useState, useEffect, useContext, useCallback } from 'react';
import {
    getTrendingTopic,
    generateGuidedPrayer,
    generateShortPrayer,
    generateSpeech,
    generateImageFromPrayer,
    createThumbnailPromptFromPost,
    createMediaPromptFromPrayer,
    generateSocialMediaPost,
    generateYouTubeLongPost,
} from '../services/geminiService';
import { SpinnerIcon, BotIcon } from './icons';
import { LanguageContext, LanguageContextType } from '../context';
import { AspectRatio, SocialMediaPost, YouTubeLongPost, MarketingHistoryItem } from '../types';
import { usePersistentState, idb } from '../hooks/usePersistentState';
import { decode, createWavFile } from '../utils/audio';

interface BotAgentProps {
    history: MarketingHistoryItem[];
    setHistory: React.Dispatch<React.SetStateAction<MarketingHistoryItem[]>>;
}

export const BotAgent: React.FC<BotAgentProps> = ({ history, setHistory }) => {
    const { t } = useContext(LanguageContext) as LanguageContextType;
    
    // Autonomous Agent States
    const [isAgentLongActive, setIsAgentLongActive] = usePersistentState<boolean>('agent_isLongActive', true);
    const [isAgentShortActive, setIsAgentShortActive] = usePersistentState<boolean>('agent_isShortActive', true);

    const [longVideoCadence, setLongVideoCadence] = usePersistentState<number>('agent_longVideoCadence', 3);
    const [shortVideoCadence, setShortVideoCadence] = usePersistentState<number>('agent_shortVideoCadence', 3);
    
    const [agentStatusLong, setAgentStatusLong] = useState<string>('');
    const [agentStatusShort, setAgentStatusShort] = useState<string>('');

    const [lastRuns, setLastRuns] = usePersistentState<{ [key: string]: number }>('agent_lastRuns', {});
    const [jobsInProgress, setJobsInProgress] = useState<string[]>([]);

    const generateAndSaveKit = useCallback(async (
        jobLang: string,
        jobType: 'long' | 'short',
        theme: string,
        subthemes: string[],
        sharedImageBlob?: Blob,
    ) => {
        // 1. Generate Text Assets SEQUENTIALLY to save Rate Limit
        let prayer: string;
        let post: SocialMediaPost | YouTubeLongPost;
    
        if (jobType === 'long') {
            prayer = await generateGuidedPrayer(theme, jobLang);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Cool down
            post = await generateYouTubeLongPost(theme, subthemes, jobLang);
        } else {
            prayer = await generateShortPrayer(theme, jobLang);
            await new Promise(resolve => setTimeout(resolve, 1000));
            post = await generateSocialMediaPost(prayer, jobLang);
        }
        if (!prayer || !post) throw new Error(`Failed to generate text assets for ${jobLang}.`);
    
        // 2. Generate Media Assets
        const audioB64 = await generateSpeech(prayer, jobType === 'long' ? { speakers: [{ name: 'Roberta Erickson', voice: 'Aoede' }, { name: 'Milton Dilts', voice: 'Enceladus' }] } : undefined);
        if (!audioB64) throw new Error("Audio generation failed");
        const pcmData = decode(audioB64);
        const audioBlob = createWavFile(pcmData, 1, 24000, 16);
    
        let imageBlob: Blob;
        if (sharedImageBlob) {
            imageBlob = sharedImageBlob;
        } else {
            // Generate fresh if not provided
            const visualPrompt = await createThumbnailPromptFromPost(post.title, post.description, prayer, jobLang);
            const aspectRatio: AspectRatio = jobType === 'short' ? '9:16' : '16:9';
            const imageB64 = await generateImageFromPrayer(visualPrompt, aspectRatio, 'imagen-4.0-generate-001');
            if (!imageB64) throw new Error("Image generation failed");
            const imageResponse = await fetch(`data:image/png;base64,${imageB64}`);
            imageBlob = await imageResponse.blob();
        }
    
        // 3. Save to History
        const id = `${Date.now()}-${jobLang}-${jobType}`;
        const audioBlobKey = `history_audio_${id}`;
        const imageBlobKey = `history_image_${id}`;
        await Promise.all([
            idb.set(audioBlobKey, audioBlob),
            idb.set(imageBlobKey, imageBlob),
        ]);
    
        const newHistoryItem: MarketingHistoryItem = {
            id,
            timestamp: Date.now(),
            type: jobType,
            language: jobLang,
            prompt: theme,
            subthemes: subthemes,
            prayer: prayer,
            socialPost: jobType === 'short' ? post as SocialMediaPost : null,
            longPost: jobType === 'long' ? post as YouTubeLongPost : null,
            audioBlobKey,
            imageBlobKey,
            isDownloaded: false,
        };
        setHistory(prev => [newHistoryItem, ...prev].sort((a, b) => b.timestamp - a.timestamp));
    }, [setHistory]);

    const runAutomatedLongVideoBatch = useCallback(async () => {
        const jobIdentifiers = ['pt-long', 'en-long', 'es-long'];
        setJobsInProgress(prev => [...prev, ...jobIdentifiers]);
        try {
            // 1. Research Topic
            const { theme, subthemes } = await getTrendingTopic('pt', 'long');
    
            // 2. Generate Shared Image Asset
            const ptPrayerForVisual = await generateGuidedPrayer(theme, 'pt');
            const visualPrompt = await createMediaPromptFromPrayer(ptPrayerForVisual);
            const imageB64 = await generateImageFromPrayer(visualPrompt, '16:9', 'imagen-4.0-generate-001');
            if (!imageB64) throw new Error("Failed to generate shared image asset.");
    
            const imageResponse = await fetch(`data:image/png;base64,${imageB64}`);
            const imageBlob = await imageResponse.blob();
            if (!imageBlob) throw new Error("Failed to create shared image blob.");
    
            // 3. Run generation SEQUENTIALLY for each language
            await generateAndSaveKit('pt', 'long', theme, subthemes, imageBlob);
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait between langs
            await generateAndSaveKit('en', 'long', theme, subthemes, imageBlob);
            await new Promise(resolve => setTimeout(resolve, 2000));
            await generateAndSaveKit('es', 'long', theme, subthemes, imageBlob);

        } catch (error) {
            console.error(`Autonomous agent long video batch failed:`, error);
        } finally {
            setJobsInProgress(prev => prev.filter(job => !jobIdentifiers.includes(job)));
        }
    }, [generateAndSaveKit]);

    const runAutomatedShortVideoJob = useCallback(async (jobLang: string) => {
        const jobIdentifier = `${jobLang}-short`;
        setJobsInProgress(prev => [...prev, jobIdentifier]);
        try {
            const { theme, subthemes } = await getTrendingTopic(jobLang, 'short');
            await generateAndSaveKit(jobLang, 'short', theme, subthemes);
        } catch (error) {
             console.error(`Autonomous agent job failed for ${jobLang}/short:`, error);
        } finally {
             setJobsInProgress(prev => prev.filter(job => job !== jobIdentifier));
        }
    }, [generateAndSaveKit]);


    useEffect(() => {
        const schedules = {
            pt: { long: [6, 12, 18], short: [9, 12, 18] },
            en: { long: [7, 13, 19], short: [9, 12, 18] },
            es: { long: [8, 14, 20], short: [9, 12, 18] },
        };
        const offsets = { pt: 0, en: 20, es: 40 };
        
        const findNextLongBatchJob = (cadence: number) => {
            const now = new Date();
            let closestJob = { time: Infinity, details: '' };

            for (let d = 0; d < 2; d++) { // Check today and tomorrow
                const checkDate = new Date(now);
                checkDate.setDate(now.getDate() + d);
                const todayStr = checkDate.toISOString().split('T')[0];
                const scheduleHours = schedules['pt'].long.slice(0, cadence);
                
                for (const hour of scheduleHours) {
                    const minute = offsets['pt'];
                    const jobKey = `${todayStr}_pt_long_batch_${hour}:${minute}`;
                    const jobTime = new Date(checkDate);
                    jobTime.setHours(hour, minute, 0, 0);

                    if (jobTime.getTime() > now.getTime() && jobTime.getTime() < closestJob.time && !lastRuns[jobKey]) {
                       closestJob = {
                           time: jobTime.getTime(),
                           details: t('agentStatusIdle')
                             .replace('{type}', t('agentTitleLong'))
                             .replace('{lang}', 'PT, EN, ES')
                             .replace('{time}', jobTime.toLocaleTimeString(t('appLocaleCode'), { hour: '2-digit', minute: '2-digit' }))
                       };
                    }
                }
                if (closestJob.time !== Infinity) break; 
            }
             return closestJob.details;
        };

        const findNextShortJob = (cadence: number) => {
            const now = new Date();
            let closestJob = { time: Infinity, details: '' };

             for (const lang of ['pt', 'en', 'es'] as const) {
                for (let d = 0; d < 2; d++) {
                    const checkDate = new Date(now);
                    checkDate.setDate(now.getDate() + d);
                    const todayStr = checkDate.toISOString().split('T')[0];
                    const scheduleHours = schedules[lang].short.slice(0, cadence);
                    
                    for (const hour of scheduleHours) {
                        const minute = offsets[lang];
                        const jobKey = `${todayStr}_${lang}_short_${hour}:${minute}`;
                        const jobTime = new Date(checkDate);
                        jobTime.setHours(hour, minute, 0, 0);

                        if (jobTime.getTime() > now.getTime() && jobTime.getTime() < closestJob.time && !lastRuns[jobKey]) {
                           closestJob = {
                               time: jobTime.getTime(),
                               details: t('agentStatusIdle')
                                 .replace('{type}', t('marketingShortVideo'))
                                 .replace('{lang}', lang.toUpperCase())
                                 .replace('{time}', jobTime.toLocaleTimeString(t('appLocaleCode'), { hour: '2-digit', minute: '2-digit' }))
                           };
                        }
                    }
                }
             }
             return closestJob.details;
        };

        const updateStatuses = () => {
            // Long video status
            const isLongJobRunning = jobsInProgress.some(job => job.endsWith('-long'));
            if (isLongJobRunning) {
                const typeStr = t('marketingLongVideo');
                setAgentStatusLong(t('agentStatusRunning').replace('{type}', typeStr).replace('{lang}', 'PT, EN, ES'));
            } else if (isAgentLongActive) {
                const nextJob = findNextLongBatchJob(longVideoCadence);
                setAgentStatusLong(nextJob || t('agentStatusIdle').replace('{type}','...').replace('{lang}','...').replace('{time}','...'));
            } else {
                setAgentStatusLong(t('agentStatusDisabled'));
            }

            // Short video status
            const runningShortJobs = jobsInProgress
                .filter(job => job.endsWith('-short'))
                .map(job => job.split('-')[0].toUpperCase());
            if (runningShortJobs.length > 0) {
                 const typeStr = t('marketingShortVideo');
                 setAgentStatusShort(t('agentStatusRunning').replace('{type}', typeStr).replace('{lang}', runningShortJobs.join(', ')));
            } else if (isAgentShortActive) {
                 const nextJob = findNextShortJob(shortVideoCadence);
                setAgentStatusShort(nextJob || t('agentStatusIdle').replace('{type}','...').replace('{lang}','...').replace('{time}','...'));
            } else {
                setAgentStatusShort(t('agentStatusDisabled'));
            }
        };

        const checkSchedule = () => {
            const now = new Date();
            const todayStr = now.toISOString().split('T')[0];
            const currentHour = now.getHours();
            const currentMinute = now.getMinutes();

            // Long video batch check (triggered by PT schedule)
            if (isAgentLongActive) {
                const scheduleHours = schedules['pt'].long.slice(0, longVideoCadence);
                for (const hour of scheduleHours) {
                    const minute = offsets['pt'];
                    const jobKey = `${todayStr}_pt_long_batch_${hour}:${minute}`;
                    const catchUpWindow = 3; // 3 hour window to catch missed jobs
                    
                    // Check if we are in the window [scheduledTime, scheduledTime + 3h]
                    // and if we haven't run it yet.
                    const isTime = (currentHour === hour && currentMinute >= minute) || (currentHour > hour && currentHour <= hour + catchUpWindow);

                    if (isTime && !lastRuns[jobKey]) {
                        console.log(`Starting Batch Job: ${jobKey}`);
                        setLastRuns(prev => ({ ...prev, [jobKey]: Date.now() }));
                        runAutomatedLongVideoBatch();
                    }
                }
            }
            
            // Short video jobs check (per language)
            if (isAgentShortActive) {
                for (const lang of ['pt', 'en', 'es'] as const) {
                    const scheduleHours = schedules[lang].short.slice(0, shortVideoCadence);
                    for (const hour of scheduleHours) {
                        const minute = offsets[lang];
                        const jobKey = `${todayStr}_${lang}_short_${hour}:${minute}`;
                        const catchUpWindow = 3;

                        const isTime = (currentHour === hour && currentMinute >= minute) || (currentHour > hour && currentHour <= hour + catchUpWindow);

                        if (isTime && !lastRuns[jobKey]) {
                            console.log(`Starting Short Job: ${jobKey}`);
                            setLastRuns(prev => ({ ...prev, [jobKey]: Date.now() }));
                            runAutomatedShortVideoJob(lang);
                        }
                    }
                }
            }
        };

        updateStatuses();
        const statusInterval = window.setInterval(updateStatuses, 60000);

        let jobIntervalId: number | undefined;
        let startupTimeoutId: number | undefined;

        if (isAgentLongActive || isAgentShortActive) {
            startupTimeoutId = setTimeout(() => {
                checkSchedule();
                jobIntervalId = window.setInterval(checkSchedule, 30000);
            }, 10000);
        }

        return () => {
            clearInterval(statusInterval);
            if (startupTimeoutId) clearTimeout(startupTimeoutId);
            if (jobIntervalId) clearInterval(jobIntervalId);
        };
    }, [isAgentLongActive, isAgentShortActive, longVideoCadence, shortVideoCadence, lastRuns, setLastRuns, runAutomatedLongVideoBatch, runAutomatedShortVideoJob, t, jobsInProgress]);

    const AgentPanel = ({
        type,
        isActive,
        setIsActive,
        cadence,
        setCadence,
        status
    }: {
        type: 'long' | 'short';
        isActive: boolean;
        setIsActive: (val: boolean) => void;
        cadence: number;
        setCadence: (val: number) => void;
        status: string;
    }) => (
         <div className="p-4 bg-gray-900 border border-teal-700 rounded-lg space-y-4 flex flex-col">
            <div className="flex items-start gap-3">
                <BotIcon className="h-6 w-6 text-teal-400 flex-shrink-0 mt-1" />
                <div>
                    <h2 className="text-lg font-bold text-teal-300">{t(type === 'long' ? 'agentTitleLong' : 'agentTitleShort')}</h2>
                    <p className="text-xs text-gray-400">{t(type === 'long' ? 'agentDescriptionLong' : 'agentDescriptionShort')}</p>
                </div>
            </div>
            <div className="flex-grow space-y-3 p-3 bg-gray-800 rounded-lg flex flex-col justify-between">
                <div className="flex items-center gap-3">
                    <label className="font-bold text-gray-300 text-sm">{t('agentStatus')}</label>
                    <label className="flex items-center cursor-pointer">
                        <input type="checkbox" id={`agent-toggle-${type}`} className="sr-only peer" checked={isActive} onChange={() => setIsActive(!isActive)} />
                        <div className="relative w-11 h-6 bg-gray-600 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-600"></div>
                        <span className={`ms-3 text-sm font-medium ${isActive ? 'text-teal-400' : 'text-gray-400'}`}>
                            {isActive ? t('agentStatusActive') : t('agentStatusInactive')}
                        </span>
                    </label>
                </div>

                <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-gray-300 whitespace-nowrap">{t(type === 'long' ? 'agentCadenceLabel' : 'agentCadenceLabelShort')}:</label>
                    <select
                        value={cadence}
                        onChange={(e) => setCadence(Number(e.target.value))}
                        disabled={!isActive}
                        className="w-full bg-gray-700 text-white p-2 rounded-md border border-gray-600 focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm disabled:opacity-50"
                    >
                        {type === 'long' ? (
                            <>
                                <option value={3}>{t('agentCadence3')}</option>
                                <option value={2}>{t('agentCadence2')}</option>
                                <option value={1}>{t('agentCadence1')}</option>
                            </>
                        ) : (
                             <>
                                <option value={3}>{t('agentCadenceShort3')}</option>
                                <option value={2}>{t('agentCadenceShort2')}</option>
                                <option value={1}>{t('agentCadenceShort1')}</option>
                                <option value={0}>{t('agentCadenceShort0')}</option>
                            </>
                        )}
                    </select>
                </div>
                 <div className="text-xs text-gray-400 italic text-center h-8 flex items-center justify-center">
                    {status.includes(t('agentStatusRunning').split(" ")[0]) ? <SpinnerIcon className="inline-flex w-4 h-4 mr-2" /> : null}
                    {status}
                </div>
            </div>
        </div>
    );

    return (
        <div className="bg-gray-800 p-6 rounded-xl shadow-lg animate-fade-in space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <AgentPanel 
                    type="long"
                    isActive={isAgentLongActive}
                    setIsActive={setIsAgentLongActive}
                    cadence={longVideoCadence}
                    setCadence={setLongVideoCadence}
                    status={agentStatusLong}
                />
                <AgentPanel 
                    type="short"
                    isActive={isAgentShortActive}
                    setIsActive={setIsAgentShortActive}
                    cadence={shortVideoCadence}
                    setCadence={setShortVideoCadence}
                    status={agentStatusShort}
                />
            </div>
            <p className="text-center text-xs text-gray-500">{t('agentKeepTabOpen')}</p>
        </div>
    );
};