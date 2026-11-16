"""Estimate target_time = source_time + offset from matching audio windows."""
import argparse, json, subprocess, time
from pathlib import Path
import numpy as np


OPENING_SECONDS = 180
INITIAL_SAMPLE_FRACTIONS = (.2, .5, .8)
RETRY_SAMPLE_FRACTIONS = (.1, .35, .65)


def audio(filename, ffmpeg):
    result = subprocess.run([ffmpeg, '-v', 'error', *(['-headers', 'Referer: https://www.bilibili.com/\r\n', '-user_agent', 'Mozilla/5.0'] if filename.startswith('https://') else []), '-i', filename, '-t', str(OPENING_SECONDS), '-vn', '-ac', '1', '-ar', '2000', '-f', 'f32le', '-'], capture_output=True, check=True, timeout=45)
    return np.frombuffer(result.stdout, dtype='<f4').astype(np.float64)


def align_spectral(source, target, rate=2000):
    source = source[:OPENING_SECONDS * rate]
    target = target[:OPENING_SECONDS * rate]
    if min(len(source), len(target)) < 24 * rate:
        raise ValueError("Need at least 24 seconds of opening audio")
    def fingerprint(signal):
        frames=np.lib.stride_tricks.sliding_window_view(signal,256)[::40]
        spectrum=np.abs(np.fft.rfft(frames*np.hanning(256),axis=1))**2
        bands=np.stack([np.log1p(spectrum[:,lo:hi].mean(axis=1)*1000) for lo,hi in [(2,5),(5,9),(9,15),(15,24),(24,38),(38,58),(58,85),(85,125)]],axis=1)
        return (bands-bands.mean(axis=0))/np.maximum(bands.std(axis=0),.001)
    a,b=fingerprint(source),fingerprint(target);window=400;matches=[]
    def match(fraction):
        start=int((min(len(a),len(b))-window)*fraction);sample=a[start:start+window];sample=sample-sample.mean(axis=0)
        size=1<<(len(b)+window-1).bit_length()
        corr=np.fft.irfft(np.fft.rfft(b,size,axis=0)*np.fft.rfft(sample[::-1],size,axis=0),size,axis=0)[window-1:len(b)].sum(axis=1)
        cumulative=np.concatenate(([0],np.cumsum((b*b).sum(axis=1))))
        score=corr/np.sqrt(np.maximum((cumulative[window:]-cumulative[:-window])*(sample*sample).sum(),1e-20))
        best=int(score.argmax());return {'source':start*.02,'target':best*.02,'offset':round((best-start)*.02,3),'score':float(score[best])}
    def consensus(anchors):
        reliable = [anchor for anchor in anchors if anchor['score'] >= .55]
        clusters = [
            [anchor for anchor in reliable if candidate['offset'] <= anchor['offset'] <= candidate['offset'] + .15]
            for candidate in reliable
        ]
        return max(clusters, key=lambda group: (len(group), sum(anchor['score'] for anchor in group)), default=[])
    matches = [match(fraction) for fraction in INITIAL_SAMPLE_FRACTIONS]
    accepted = consensus(matches)
    retried = len(accepted) < 3 or np.median([anchor["score"] for anchor in accepted]) < .6
    if retried:
        # One extra batch only. A failed result exits instead of scheduling another retry.
        matches.extend(match(fraction) for fraction in RETRY_SAMPLE_FRACTIONS)
        accepted = consensus(matches)
    if len(accepted) < 3 or np.median([anchor['score'] for anchor in accepted]) < .6:
        raise ValueError('Opening audio confidence too low after retry ' + json.dumps(matches))
    competing = consensus([anchor for anchor in matches if anchor not in accepted])
    if len(competing) >= 3:
        raise ValueError('Ambiguous opening audio offsets ' + json.dumps(matches))
    return {'offsetSeconds':float(np.median([anchor['offset'] for anchor in accepted])),
            'anchors':accepted, 'rejectedAnchors':[anchor for anchor in matches if anchor not in accepted],
            'retried':retried, 'sampling':'opening-consensus-v2'}



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




