const { twMerge } = require('tailwind-merge');
const inputClass = 'flex h-12 w-full rounded-none border-2 border-primary bg-background px-4 py-2 font-bold text-foreground shadow-[2px_2px_0px_#111] file:border-0 file:bg-transparent file:font-display file:text-[11px] file:font-bold file:uppercase file:tracking-widest placeholder:font-bold placeholder:text-muted-foreground focus-visible:border-accent focus-visible:outline-none focus-visible:ring-0 focus-visible:shadow-[4px_4px_0px_#E51D34] disabled:cursor-not-allowed disabled:opacity-50 transition-all';
const onInk = 'border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground placeholder:text-primary-foreground/45 focus-visible:shadow-[4px_4px_0px_#E51D34]';
console.log(twMerge(inputClass, onInk));
