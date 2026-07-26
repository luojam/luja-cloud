export function BrandMark() {
    return (
        <h1
            className='relative inline-flex w-fit items-baseline text-[clamp(2.75rem,8vw,4rem)] leading-none tracking-[-0.04em]'
            aria-label='luja Cloud'
        >
            <span
                className='font-[680] [font-variation-settings:"wdth"_86,"wght"_680]'
                aria-hidden='true'
            >
                luja
            </span>
            <span
                className='text-muted-foreground ml-2.5 font-[390] [font-variation-settings:"wdth"_96,"wght"_390]'
                aria-hidden='true'
            >
                Cloud
            </span>
            <span
                className='bg-primary absolute top-[-0.18em] left-[0.055em] h-1 w-[0.72em] rounded-xs'
                aria-hidden='true'
            />
        </h1>
    );
}
