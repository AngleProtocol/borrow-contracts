import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, Signer } from 'ethers';
import { parseEther, parseUnits } from 'ethers/lib/utils';
import hre, { contract, ethers, network, web3 } from 'hardhat';

import {
    AToken,
    AToken__factory,
    ERC20,
    ERC20__factory,
    IAngleRouterSidechain,
    IERC20,
    IMetaPool3,
    IMetaPool3__factory,
    IUniswapV3Router,
    IUniswapV3Router__factory,
    MockBorrowStaker,
    MockBorrowStaker__factory,
    MockCoreBorrow,
    MockCoreBorrow__factory,
    MockCurveLevSwapper3TokensWithBP,
    MockCurveLevSwapper3TokensWithBP__factory,
    MockRouter,
    MockRouter__factory,
    MockToken,
    MockToken__factory,
} from '../../../typechain';
import { expect } from '../utils/chai-setup';
import { deployUpgradeable, MAX_UINT256, ZERO_ADDRESS } from '../utils/helpers';


export enum SwapType {
    UniswapV3,
    oneINCH,
    AngleRouter,
    Leverage,
    None,
}

contract('SwapperCurveTricryptoPolygon', () => {
    let deployer: SignerWithAddress;
    let alice: SignerWithAddress;

    let swapper: MockCurveLevSwapper3TokensWithBP;
    let staker: MockBorrowStaker;
    let router: MockRouter;
    let core: MockCoreBorrow;
    let asset: MockToken;
    // let USDC, USDT, DAI, amDAI, amUSDC, amUSDT, amWBTC: MockToken, amWETH: MockToken, AaveBPToken: MockToken;
    let amWBTC: MockToken, amWETH: MockToken, AaveBPToken: MockToken;
    let amWBTCAToken: AToken, amWETHAToken: AToken;
    let META_POOL: IMetaPool3, AAVE_BPPOOL: IMetaPool3;

    let _GOVERNOR = '0xdC4e6DFe07EFCa50a197DF15D9200883eF4Eb1c8';
    let _ONE_INCH = '0x1111111254fb6c44bAC0beD2854e76F90643097d';
    let _UNI_V3_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
    let _asset = '0xdAD97F7713Ae9437fa9249920eC8507e5FbB23d3';
    let _USDC = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
    let _USDT = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
    let _DAI = '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063';
    let _amUSDC = '0x1a13F4Ca1d028320A707D99520AbFefca3998b7F';
    let _amUSDT = '0x60D55F02A771d515e077c9C2403a1ef324885CeC';
    let _amDAI = '0x27F8D03b3a2196956ED754baDc28D73be8830A6e';
    let _AaveBPToken = '0xE7a24EF0C5e95Ffb0f6684b813A78F2a3AD7D171';
    let _amWBTC = '0x5c2ed810328349100A66B82b78a1791B101C9D61';
    let _amWETH = '0x28424507fefb6f7f8E9D3860F56504E4e5f5f390';
    // let _DECIMAL_NORM_USDC = BigNumber.from(10 ** 12);
    // let _DECIMAL_NORM_USDT = BigNumber.from(10 ** 12);

    let _META_POOL = '0x92215849c439E1f8612b6646060B4E3E5ef822cC';
    let _AAVE_BPPOOL = '0x445FE580eF8d70FF569aB36e80c647af338db351';
    let _AAVE_LENDING_POOL = '0x8dFf5E27EA6b7AC08EbFdf9eB090F32ee9a30fcf';

    // payload to swap 100000 USDC for amUSDC on 1inch
    let _PAYLOAD_USDC =
        '0x7c0252000000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000001800000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa841740000000000000000000000001a13f4ca1d028320a707d99520abfefca3998b7f0000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf00000000000000000000000022b852160c4034a7b96684ed9aeff97825ca7801000000000000000000000000000000000000000000000000000000174876e800000000000000000000000000000000000000000000000000000000170cdc1e00000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000011c0000000000000000000000000000000000000000000000000000de0000b051208dff5e27ea6b7ac08ebfdf9eb090f32ee9a30fcf2791bca1f2de4661ed88a30c99a7a9449aa841740024e8eda9df0000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa8417400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf000000000000000000000000000000000000000000000000000000000000044d80a06c4eca271a13f4ca1d028320a707d99520abfefca3998b7f1111111254fb6c44bac0bed2854e76f90643097d000000000000000000000000000000000000000000000000000000174876e80000000000cfee7c08';
    // payload to swap 100000 DAI for amDAI on 1inch
    let _PAYLOAD_DAI =
        '0x7c0252000000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000001800000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a06300000000000000000000000027f8d03b3a2196956ed754badc28d73be8830a6e0000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf00000000000000000000000022b852160c4034a7b96684ed9aeff97825ca780100000000000000000000000000000000000000000000152d02c7e14af68000000000000000000000000000000000000000000000000014f6ccfe338517e00000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000011c0000000000000000000000000000000000000000000000000000de0000b051208dff5e27ea6b7ac08ebfdf9eb090f32ee9a30fcf8f3cf7ad23cd3cadbd9735aff958023239c6a0630024e8eda9df0000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a06300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf000000000000000000000000000000000000000000000000000000000000044d80a06c4eca2727f8d03b3a2196956ed754badc28d73be8830a6e1111111254fb6c44bac0bed2854e76f90643097d00000000000000000000000000000000000000000000152d02c7e14af680000000000000cfee7c08';
    // payload to swap 100000 USDT for amUSDT on 1inch
    let _PAYLOAD_USDT =
        '0x7c0252000000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf00000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000180000000000000000000000000c2132d05d31c914a87c6611c10748aeb04b58e8f00000000000000000000000060d55f02a771d515e077c9c2403a1ef324885cec0000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf00000000000000000000000022b852160c4034a7b96684ed9aeff97825ca7801000000000000000000000000000000000000000000000000000000174876e800000000000000000000000000000000000000000000000000000000170cdc1e00000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000011c0000000000000000000000000000000000000000000000000000de0000b051208dff5e27ea6b7ac08ebfdf9eb090f32ee9a30fcfc2132d05d31c914a87c6611c10748aeb04b58e8f0024e8eda9df000000000000000000000000c2132d05d31c914a87c6611c10748aeb04b58e8f00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000d15038f8a0362b4ce71d6c879d56bf9fc2884cf000000000000000000000000000000000000000000000000000000000000044d80a06c4eca2760d55f02a771d515e077c9c2403a1ef324885cec1111111254fb6c44bac0bed2854e76f90643097d000000000000000000000000000000000000000000000000000000174876e80000000000cfee7c08';

    let _BPS = 10000;
    let decimalToken = 18;
    let decimalReward = 6;
    let rewardAmount = 10 ** 2 * 10 ** decimalReward;
    let maxTokenAmount = 10 ** 15 * 10 ** decimalToken;
    let SLIPPAGE_BPS = 9900;

    const impersonatedSigners: { [key: string]: Signer } = {};

    beforeEach(async () => {
        await network.provider.request({
            method: 'hardhat_reset',
            params: [
                {
                    forking: {
                        jsonRpcUrl: process.env.ETH_NODE_URI_FORKPOLYGON,
                        blockNumber: 35401716,
                    },
                },
            ],
        });

        const impersonatedAddresses = [_GOVERNOR, _AAVE_LENDING_POOL, _AAVE_BPPOOL];

        for (const address of impersonatedAddresses) {
            await hre.network.provider.request({
                method: 'hardhat_impersonateAccount',
                params: [address],
            });
            await hre.network.provider.send('hardhat_setBalance', [address, '0x10000000000000000000000000000']);
            impersonatedSigners[address] = await ethers.getSigner(address);
        }

        [deployer, alice] = await ethers.getSigners();
        core = (await new MockCoreBorrow__factory(deployer).deploy()) as MockCoreBorrow;
        await core.connect(alice).toggleGovernor(_GOVERNOR);
        router = (await new MockRouter__factory(deployer).deploy()) as MockRouter;

        asset = (await ethers.getContractAt(MockToken__factory.abi, _asset)) as MockToken;
        // USDC = (await ethers.getContractAt(MockToken__factory.abi, _USDC)) as MockToken;
        // USDT = (await ethers.getContractAt(MockToken__factory.abi, _USDT)) as MockToken;
        // DAI = (await ethers.getContractAt(MockToken__factory.abi, _DAI)) as MockToken;
        // amUSDC = (await ethers.getContractAt(MockToken__factory.abi, _amUSDC)) as MockToken;
        // amUSDT = (await ethers.getContractAt(MockToken__factory.abi, _amUSDT)) as MockToken;
        // amDAI = (await ethers.getContractAt(MockToken__factory.abi, _amDAI)) as MockToken;
        amWBTC = (await ethers.getContractAt(MockToken__factory.abi, _amWBTC)) as MockToken;
        amWETH = (await ethers.getContractAt(MockToken__factory.abi, _amWETH)) as MockToken;
        amWBTCAToken = (await ethers.getContractAt(AToken__factory.abi, _amWBTC)) as AToken;
        amWETHAToken = (await ethers.getContractAt(AToken__factory.abi, _amWETH)) as AToken;
        AaveBPToken = (await ethers.getContractAt(MockToken__factory.abi, _AaveBPToken)) as MockToken;

        META_POOL = (await ethers.getContractAt(IMetaPool3__factory.abi, _META_POOL)) as IMetaPool3;
        AAVE_BPPOOL = (await ethers.getContractAt(IMetaPool3__factory.abi, _AAVE_BPPOOL)) as IMetaPool3;

        staker = (await deployUpgradeable(new MockBorrowStaker__factory(deployer))) as MockBorrowStaker;
        await staker.initialize(core.address, asset.address);
        swapper = (await new MockCurveLevSwapper3TokensWithBP__factory(deployer).deploy(
            core.address,
            _UNI_V3_ROUTER,
            _ONE_INCH,
            router.address,
            staker.address,
        )) as MockCurveLevSwapper3TokensWithBP;

        expect(await staker.name()).to.be.equal('Angle Curve USD-BTC-ETH Staker');
        expect(await staker.symbol()).to.be.equal('agstk-crvUSDBTCETH');
        expect(await staker.decimals()).to.be.equal(18);

        await swapper
            .connect(impersonatedSigners[_GOVERNOR])
            .changeAllowance(
                [_USDC, _USDT, _DAI, _amUSDC, _amDAI, _amUSDT, _AaveBPToken, _amWBTC, _amWETH, _asset],
                [
                    _ONE_INCH,
                    _ONE_INCH,
                    _ONE_INCH,
                    _AAVE_BPPOOL,
                    _AAVE_BPPOOL,
                    _AAVE_BPPOOL,
                    _META_POOL,
                    _META_POOL,
                    _META_POOL,
                    staker.address,
                ],
                [
                    ethers.constants.MaxUint256,
                    ethers.constants.MaxUint256,
                    ethers.constants.MaxUint256,
                    ethers.constants.MaxUint256,
                    ethers.constants.MaxUint256,
                    ethers.constants.MaxUint256,
                    ethers.constants.MaxUint256,
                    ethers.constants.MaxUint256,
                    ethers.constants.MaxUint256,
                    ethers.constants.MaxUint256,
                ],
            );

        // await USDC.connect(alice).approve(swapper.address, ethers.constants.MaxUint256);
        // await USDT.connect(alice).approve(swapper.address, ethers.constants.MaxUint256);
        // await DAI.connect(alice).approve(swapper.address, ethers.constants.MaxUint256);
        // await amUSDC.connect(alice).approve(swapper.address, ethers.constants.MaxUint256);
        // await amUSDT.connect(alice).approve(swapper.address, ethers.constants.MaxUint256);
        // await amDAI.connect(alice).approve(swapper.address, ethers.constants.MaxUint256);
        await amWBTC.connect(alice).approve(swapper.address, ethers.constants.MaxUint256);
        await amWETH.connect(alice).approve(swapper.address, ethers.constants.MaxUint256);

    });

    describe('leverage', () => {
        it('success - no Aave tokens', async () => {

            let amountAaveBP = BigNumber.from(1).pow(BigNumber.from(18));
            let amountAmWBTC = BigNumber.from(1).pow(BigNumber.from(8));
            let amountAmWETH = BigNumber.from(1).pow(BigNumber.from(18));

            await AaveBPToken.connect(impersonatedSigners[_AAVE_BPPOOL]).mint(alice.address, amountAaveBP);
            await amWETHAToken.connect(impersonatedSigners[_AAVE_LENDING_POOL]).mint(alice.address, amountAmWETH.mul(BigNumber.from(10)), BigNumber.from(10));
            await amWBTCAToken.connect(impersonatedSigners[_AAVE_LENDING_POOL]).mint(alice.address, amountAmWBTC.mul(BigNumber.from(10)), BigNumber.from(10));


            // intermediary variables
            let minAmountOut =
                (await META_POOL.connect(alice)['calc_token_amount(uint256[3],bool)']([amountAaveBP, amountAmWBTC, amountAmWETH], true)).mul(BigNumber.from(SLIPPAGE_BPS)).div(BigNumber.from(_BPS))

            const addData = ethers.utils.defaultAbiCoder.encode(['bool'], [false]);
            const swapData = ethers.utils.defaultAbiCoder.encode(['bytes[]', 'bytes'], [[], addData]);
            const leverageData = ethers.utils.defaultAbiCoder.encode(['bool', 'string', 'bytes'], [true, alice.address, swapData]);
            const data = ethers.utils.defaultAbiCoder.encode(['string', 'uint256', 'uint256', 'bytes'], [ethers.constants.AddressZero, ethers.constants.Zero, SwapType.Leverage, leverageData]);

            await AaveBPToken.connect(alice).transfer(alice.address, amountAaveBP);
            await amWETH.connect(alice).transfer(swapper.address, amountAmWETH);
            await amWBTC.connect(alice).transfer(swapper.address, amountAmWBTC);

            await swapper.swap(AaveBPToken.address, staker.address, alice.address, ethers.constants.Zero, amountAaveBP, data);

        });
    });
});
