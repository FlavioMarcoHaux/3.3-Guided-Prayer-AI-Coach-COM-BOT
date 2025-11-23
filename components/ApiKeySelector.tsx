import React, { useState, useContext } from 'react';
import { LogoIcon, SpinnerIcon } from './icons';
import { LanguageContext, LanguageContextType } from '../context';

interface ApiKeySelectorProps {
    onKeySelected: (key: string) => void;
}

export const ApiKeySelector: React.FC<ApiKeySelectorProps> = ({ onKeySelected }) => {
    const [inputKey, setInputKey] = useState('');
    const [error, setError] = useState('');
    const { t } = useContext(LanguageContext) as LanguageContextType;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!inputKey.trim()) {
            setError('Please enter a valid API Key');
            return;
        }
        // Basic validation could be added here
        onKeySelected(inputKey.trim());
    };

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-900 p-4 font-sans">
            <div className="bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-md w-full border border-gray-700 text-center animate-fade-in">
                <div className="flex justify-center mb-6">
                    <LogoIcon />
                </div>
                <h1 className="text-3xl font-bold text-amber-400 mb-4">{t('apiKeyTitle')}</h1>
                <p className="text-gray-400 mb-8">{t('apiKeyDescription')}</p>
                
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="text-left">
                        <label className="block text-xs text-gray-500 mb-1 uppercase tracking-wider font-bold">Google GenAI Key</label>
                        <input 
                            type="password" 
                            value={inputKey}
                            onChange={(e) => setInputKey(e.target.value)}
                            placeholder={t('apiKeyPlaceholder')}
                            className="w-full bg-gray-700 text-white placeholder-gray-500 p-4 rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-amber-500 transition font-mono text-sm"
                        />
                    </div>
                    {error && <p className="text-red-400 text-sm">{error}</p>}
                    
                    <button 
                        type="submit"
                        className="w-full bg-amber-500 text-gray-900 font-bold py-3 px-6 rounded-lg hover:bg-amber-600 transition-all duration-300 transform hover:scale-105"
                    >
                        {t('apiKeyButton')}
                    </button>
                </form>
                <div className="mt-6">
                    <p className="text-xs text-gray-500 mb-2">{t('apiKeyHelp')}</p>
                    <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-sky-400 hover:text-sky-300 text-sm underline font-medium">
                        {t('apiKeyLinkText')}
                    </a>
                </div>
            </div>
        </div>
    );
};