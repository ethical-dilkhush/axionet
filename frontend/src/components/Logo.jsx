export default function Logo({ size = 40, className = '', style }) {
  return (
    <img
      src="/axionet.webp"
      alt="Axionet"
      width={size}
      height={size}
      className={className}
      style={{ display: 'block', objectFit: 'contain', ...style }}
      draggable={false}
    />
  )
}
