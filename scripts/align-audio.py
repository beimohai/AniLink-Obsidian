"""Estimate target_time = source_time + offset from matching audio windows."""
import argparse, json, subprocess, time
from pathlib import Path
import numpy as np


def audio(filename, ffmpeg):
    result = subprocess.run([ffmpeg, '-v', 'error', *(['-headers', 'Referer: https://www.bilibili.com/\r\n', '-user_agent', 'Mozilla/5.0'] if filename.startswith('https://') else []), '-i', filename, '-vn', '-ac', '1', '-ar', '2000', '-f', 'f32le', '-'], capture_output=True, check=True)
    return np.frombuffer(result.stdout, dtype='<f4').astype(np.float64)


def align(source, target, rate=2000):
    window = 8 * rate
    if min(len(source), len(target)) < 3 * window:
        raise ValueError('Need at least 24 seconds of matching audio')
    matches = []
    for fraction in [0.2, 0.5, 0.8]:
        start = int((len(source)-window)*fraction)
        sample = source[start:start+window].copy()
        sample -= sample.mean()
        energy = np.dot(sample, sample)
        if energy < 1e-8:
            continue
        size = 1 << (len(target)+window-1).bit_length()
        correlation = np.fft.irfft(np.fft.rfft(target, size)*np.fft.rfft(sample[::-1], size), size)[window-1:len(target)]
        cumulative = np.concatenate(([0.0], np.cumsum(target*target)))
        target_energy = cumulative[window:] - cumulative[:-window]
        score = correlation / np.sqrt(np.maximum(target_energy*energy, 1e-20))
        best = int(np.argmax(score))
        matches.append({'source':start/rate, 'target':best/rate, 'offset':(best-start)/rate, 'score':float(score[best])})
    if len(matches) < 3 or min(m['score'] for m in matches) < 0.55:
        raise ValueError('Audio match confidence too low')
    offsets = [m['offset'] for m in matches]
    if max(offsets)-min(offsets) > 0.15:
        raise ValueError('Edits or drift detected; a single offset is unsafe: '+json.dumps(matches))
    return {'offsetSeconds':float(np.median(offsets)), 'anchors':matches}


def align_spectral(source, target, rate=2000):
    def fingerprint(signal):
        frames=np.lib.stride_tricks.sliding_window_view(signal,256)[::40]
        spectrum=np.abs(np.fft.rfft(frames*np.hanning(256),axis=1))**2
        bands=np.stack([np.log1p(spectrum[:,lo:hi].mean(axis=1)*1000) for lo,hi in [(2,5),(5,9),(9,15),(15,24),(24,38),(38,58),(58,85),(85,125)]],axis=1)
        return (bands-bands.mean(axis=0))/np.maximum(bands.std(axis=0),.001)
    a,b=fingerprint(source),fingerprint(target);window=400;matches=[]
    for fraction in [.2,.5,.8]:
        start=int((min(len(a),len(b))-window)*fraction);sample=a[start:start+window];sample=sample-sample.mean(axis=0)
        size=1<<(len(b)+window-1).bit_length()
        corr=np.fft.irfft(np.fft.rfft(b,size,axis=0)*np.fft.rfft(sample[::-1],size,axis=0),size,axis=0)[window-1:len(b)].sum(axis=1)
        cumulative=np.concatenate(([0],np.cumsum((b*b).sum(axis=1))))
        score=corr/np.sqrt(np.maximum((cumulative[window:]-cumulative[:-window])*(sample*sample).sum(),1e-20))
        best=int(score.argmax());matches.append({'source':start*.02,'target':best*.02,'offset':round((best-start)*.02,3),'score':float(score[best])})
    if min(m['score'] for m in matches)<.4 or sorted(m['score'] for m in matches)[1]<.6:raise ValueError('Spectral confidence too low '+json.dumps(matches))
    offsets=[m['offset'] for m in matches]
    if max(offsets)-min(offsets)>.15:raise ValueError('Edits or drift '+json.dumps(matches))
    return {'offsetSeconds':float(np.median(offsets)),'anchors':matches}


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('source');parser.add_argument('target')
    parser.add_argument('--ffmpeg',default='ffmpeg')
    parser.add_argument('--xml');parser.add_argument('--output')
    args=parser.parse_args();started=time.perf_counter()
    result=align_spectral(audio(args.source,args.ffmpeg),audio(args.target,args.ffmpeg))
    if args.xml:
        import xml.etree.ElementTree as ET
        if not args.output or Path(args.xml).resolve()==Path(args.output).resolve():
            raise ValueError('Provide a separate output XML path')
        tree=ET.parse(args.xml)
        for node in list(tree.getroot()):
            if node.tag!='d':continue
            fields=node.attrib['p'].split(',');stamp=float(fields[0])+result['offsetSeconds']
            if stamp<0:tree.getroot().remove(node)
            else:fields[0]=str(round(stamp,3));node.set('p',','.join(fields))
        with open(args.output,'xb') as handle:tree.write(handle,encoding='utf-8',xml_declaration=True)
    result['elapsedSeconds']=time.perf_counter()-started
    print(json.dumps(result))




