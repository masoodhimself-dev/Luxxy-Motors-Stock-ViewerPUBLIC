import { useEffect, useRef, useState } from 'react';

/** Produce small still JPEGs; the server independently validates and strips metadata. */
async function preparePhoto(file:File):Promise<string> {
  if(!file.type.startsWith('image/') || file.size>16_000_000) throw new Error('Choose an image under 16 MB.');
  const url=URL.createObjectURL(file);
  try {
    const image=new Image();
    await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('Could not open that image.'));image.src=url;});
    const width=image.naturalWidth,height=image.naturalHeight;
    if(!width || !height || width*height>40_000_000)throw new Error('Choose a smaller image.');
    const scale=Math.min(1,1600/Math.max(width,height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
    const context=canvas.getContext('2d');if(!context)throw new Error('Could not prepare the image.');
    context.drawImage(image,0,0,canvas.width,canvas.height);
    let result=canvas.toDataURL('image/jpeg',0.76);
    if(result.length>2_000_000)result=canvas.toDataURL('image/jpeg',0.55);
    if(!result.startsWith('data:image/jpeg;base64,') || result.length>2_000_000)throw new Error('This image is too large after compression.');
    return result;
  } finally {URL.revokeObjectURL(url);}
}

export function TestPhotoInput({onChange,onBusyChange}:{onChange:(photos:string[])=>void;onBusyChange:(busy:boolean)=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[count,setCount]=useState(0);
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
  return <label className="grid gap-1 text-sm">Photos (up to 2)
    <input type="file" accept="image/*" multiple disabled={busy} onChange={async e=>{
      const files=Array.from(e.currentTarget.files??[]);setError('');onChange([]);setCount(0);
      if(files.length>2){setError('Choose up to two photos.');return;}
      if(!files.length)return;setBusy(true);onBusyChange(true);
      try{const photos=[];for(const file of files)photos.push(await preparePhoto(file));if(mounted.current){onChange(photos);setCount(photos.length);}}catch(err){if(mounted.current)setError(err instanceof Error?err.message:'Could not prepare the photos.');}finally{if(mounted.current){setBusy(false);onBusyChange(false);}}
    }}/>
    <small>{busy?'Preparing photos…':count?`${count} photo${count===1?'':'s'} ready`:'Photos are compressed before sending.'}</small>
    {error && <span role="alert">{error}</span>}
  </label>;
}
