/* eslint no-plusplus: ["error", { "allowForLoopAfterthoughts": true }] */
const details = () => ({
  id: 'Tdarr_Plugin_FlowHDR_AdaptiveNVENC_HDR',
  Stage: 'Pre-processing',
  Name: 'FlowHDR Adaptive NVENC HDR',
  Type: 'Video',
  Operation: 'Transcode',
  Description: 'Adaptive NVENC re-encode preserving all HDR metadata from source (10-bit forced).',
  Version: '1.1',
  Tags: 'flowhdr,hdr,nvenc,adaptive',
  Inputs: [
    { name: 'container', type: 'string', defaultValue: 'original', inputUI: { type: 'text' },
      tooltip: 'Output container. original = keep.' },
    { name: 'bitrate_cutoff', type: 'string', defaultValue: '', inputUI: { type: 'text' },
      tooltip: 'Skip encode if current bitrate below this (kbps). Empty disables.' },
    { name: 'enable_bframes', type: 'boolean', defaultValue: true, inputUI: { type: 'dropdown', options: ['false','true'] },
      tooltip: 'Use NVENC B-frames.' },
    { name: 'force_conform', type: 'boolean', defaultValue: false, inputUI: { type: 'dropdown', options: ['false','true'] },
      tooltip: 'Remove unsupported streams for target container.' },
    { name: 'cq', type: 'string', defaultValue: '21', inputUI: { type: 'text' },
      tooltip: 'NVENC CQ value.' },
  ],
});

const plugin = (file, librarySettings, inputs, otherArguments) => {
  const lib = (() => { try { return require('../methods/lib')(); } catch { return { loadDefaultValues: (a)=>a }; } })();
  inputs = lib.loadDefaultValues(inputs, details);
  const r = {
    processFile: false,
    preset: '',
    handBrakeMode: false,
    FFmpegMode: true,
    reQueueAfter: true,
    infoLog: '',
  };

  if (file.fileMedium !== 'video') { r.infoLog+='Skip: not video.\n'; return r; }

  // Calculate bitrate from file
  let durationSeconds = 0;
  try {
    if (parseFloat(file.ffProbeData?.format?.duration) > 0) {
      durationSeconds = parseFloat(file.ffProbeData.format.duration);
    } else if (file.ffProbeData?.streams?.[0]?.duration) {
      durationSeconds = parseFloat(file.ffProbeData.streams[0].duration);
    }
  } catch (e) {}

  let bitRateBps = 0;
  try {
    if (file.ffProbeData?.format?.bit_rate && Number(file.ffProbeData.format.bit_rate) > 0) {
      bitRateBps = Number(file.ffProbeData.format.bit_rate);
    } else if (file.ffProbeData?.streams?.[0]?.bit_rate && Number(file.ffProbeData.streams[0].bit_rate) > 0) {
      bitRateBps = Number(file.ffProbeData.streams[0].bit_rate);
    } else if (file.file_size && durationSeconds > 0) {
      bitRateBps = (Number(file.file_size) * 8) / durationSeconds;
    }
  } catch (e) {}

  const currentBitrate = bitRateBps ? Math.round(bitRateBps / 1000) : 0;
  if (currentBitrate === 0) {
    r.infoLog+='Skip: unable to determine bitrate.\n';
    return r;
  }

  const targetBitrate = Math.round(currentBitrate / 2);
  const minimumBitrate = Math.round(targetBitrate * 0.7);
  const maximumBitrate = Math.round(targetBitrate * 1.3);

  // Bitrate cutoff
  if (inputs.bitrate_cutoff !== '') {
    const cutoff = parseInt(inputs.bitrate_cutoff, 10);
    if (!Number.isNaN(cutoff) && currentBitrate < cutoff) {
      r.infoLog+=`Skip: currentBitrate ${currentBitrate} < cutoff ${cutoff}.\n`;
      return r;
    }
  }

  // Container
  const outContainer = inputs.container === 'original' ? file.container : inputs.container;
  r.container = `.${outContainer}`;

  // HDR metadata extraction
  let hdr = '';
  const streams = file.ffProbeData?.streams || [];
  for (const s of streams) {
    if (s.codec_type?.toLowerCase() === 'video') {
      const sideData = s.side_data_list || [];
      for (const sd of sideData) {
        if (sd.side_data_type === 'Mastering display metadata') {
          const r = sd.red_x ? `G(${sd.green_x},${sd.green_y})B(${sd.blue_x},${sd.blue_y})R(${sd.red_x},${sd.red_y})WP(${sd.white_point_x},${sd.white_point_y})` : '';
          const l = sd.max_luminance ? `L(${sd.max_luminance},${sd.min_luminance})` : '';
          if (r || l) hdr += `-master-display "${r}${l}" `;
        }
        if (sd.side_data_type === 'Content light level metadata' && sd.max_content) {
          hdr += `-max-cll "${sd.max_content},${sd.max_average}" `;
        }
      }
      break;
    }
  }

  // genpts for ts/avi
  let genpts = '';
  if (['ts','avi'].includes(outContainer.toLowerCase())) genpts='-fflags +genpts ';

  // Stream conform + picture removal
  let extraMaps = '';
  let vidIdx = 0;
  streams.forEach((s)=>{
    if (s.codec_type?.toLowerCase()==='video') {
      if (['mjpeg','png'].includes((s.codec_name||'').toLowerCase())) extraMaps += `-map -v:${vidIdx} `;
      vidIdx++;
    }
  });

  if (inputs.force_conform) {
    if (outContainer.toLowerCase()==='mp4') {
      streams.forEach((s,i)=>{
        const n=(s.codec_name||'').toLowerCase();
        if (['hdmv_pgs_subtitle','eia_608','subrip','timed_id3'].includes(n)) extraMaps+=`-map -0:${i} `;
      });
    } else if (outContainer.toLowerCase()==='mkv') {
      streams.forEach((s,i)=>{
        const n=(s.codec_name||'').toLowerCase();
        if (['mov_text','eia_608','timed_id3','data'].includes(n)) extraMaps+=`-map -0:${i} `;
      });
    }
  }

  // HDR always uses 10bit
  const pixFmt = '-pix_fmt p010le -profile:v main10';

  // B-frames
  const bframes = inputs.enable_bframes ? '-bf 5 -b_ref_mode each ' : '';

  // Bitrate settings
  const bitrateBlock = `-b:v ${targetBitrate}k -minrate ${minimumBitrate}k -maxrate ${maximumBitrate}k -bufsize ${currentBitrate}k`;

  // Preset
  const cq = inputs.cq;
  r.preset = `${genpts}<io> -map 0 -c:v hevc_nvenc -preset p7 -rc:v vbr -cq:v ${cq} ${bframes}-spatial_aq 1 -rc-lookahead 32 ${pixFmt} ${bitrateBlock} ${hdr}-fps_mode passthrough -c:a copy -c:s copy -max_muxing_queue_size 9999 ${extraMaps}`.trim();

  r.processFile = true;
  r.infoLog += `HDR NVENC adaptive: cq=${cq} cur=${currentBitrate} target=${targetBitrate} min=${minimumBitrate} max=${maximumBitrate}\n`;
  return r;
};

module.exports.details = details;
module.exports.plugin = plugin;